// 날씨: Open-Meteo 기본 예보 + 기관별 예보 모델 비교
// app.js보다 먼저 로드됨. state/fmt/sunTimes 등은 호출 시점에 app.js에서 가져와 씀.

const WX_HOURLY = [
  "temperature_2m", "apparent_temperature", "relative_humidity_2m", "dew_point_2m",
  "precipitation_probability", "precipitation", "weather_code",
  "cloud_cover", "cloud_cover_low", "cloud_cover_mid", "cloud_cover_high", "visibility",
  "wind_speed_10m", "wind_direction_10m", "wind_gusts_10m", "uv_index",
];
const WX_DAILY = [
  "weather_code", "temperature_2m_max", "temperature_2m_min", "precipitation_sum", "precipitation_hours",
  "precipitation_probability_max", "wind_speed_10m_max", "wind_gusts_10m_max", "wind_direction_10m_dominant",
  "uv_index_max", "sunshine_duration",
];
const WX_MODELS = [
  { id: "kma_seamless", name: "기상청", org: "KMA · 대한민국" },
  { id: "ecmwf_ifs025", name: "ECMWF", org: "유럽중기예보센터" },
  { id: "gfs_seamless", name: "GFS", org: "미국 NOAA" },
  { id: "jma_seamless", name: "JMA", org: "일본 기상청" },
  { id: "icon_seamless", name: "ICON", org: "독일 기상청 DWD" },
];
const WMO = {
  0: "맑음", 1: "대체로 맑음", 2: "구름 조금", 3: "흐림", 45: "안개", 48: "상고대 안개",
  51: "약한 이슬비", 53: "이슬비", 55: "강한 이슬비", 56: "어는 이슬비", 57: "어는 이슬비",
  61: "약한 비", 63: "비", 65: "강한 비", 66: "어는 비", 67: "어는 비",
  71: "약한 눈", 73: "눈", 75: "강한 눈", 77: "싸락눈",
  80: "약한 소나기", 81: "소나기", 82: "강한 소나기", 85: "소낙눈", 86: "강한 소낙눈",
  95: "뇌우", 96: "뇌우·우박", 99: "강한 뇌우·우박",
};
const wmoKind = (c) => c == null ? "none" : c <= 1 ? "clear" : c <= 3 ? "cloud" : c <= 48 ? "fog" : c >= 95 ? "storm" : (c >= 71 && c <= 77) || c >= 85 ? "snow" : "rain";
const wmoLabel = (c) => `<span class="wx-code ${wmoKind(c)}"><i></i>${WMO[c] ?? "–"}</span>`;

const modelCache = new Map();
let wxTab = "hourly";
try { wxTab = localStorage.getItem("wxTab") || "hourly"; } catch {}

const num = (v, d = 0) => (v == null || isNaN(v) ? "–" : Number(v).toFixed(d));
const windName = (deg) => (deg == null ? "" : `${compassName(deg)}풍`);

function hourIdx(day) {
  const h = state.wx?.hourly;
  if (!h) return [];
  const out = [];
  h.time.forEach((t, i) => { if (t.startsWith(day)) out.push(i); });
  return out;
}
function dayIdx(day) { return state.wx?.daily ? state.wx.daily.time.indexOf(day) : -1; }

// ── 촬영 체크 (해가 있는 시간 ±1시간 기준) ─────────────────────
function shootingAlerts(day) {
  const h = state.wx.hourly, idx = hourIdx(day);
  if (!idx.length) return null;
  const t = sunTimes(day);
  const from = minuteOf(t.dawn, day) - 60, to = minuteOf(t.dusk, day) + 60;
  const win = idx.filter((i) => { const m = +h.time[i].slice(11, 13) * 60; return m >= from && m <= to; });
  const at = (i) => `${h.time[i].slice(11, 13)}시`;
  const maxBy = (k) => win.reduce((a, i) => (h[k][i] ?? -1) > (h[k][a] ?? -1) ? i : a, win[0]);
  const minBy = (k) => win.reduce((a, i) => (h[k][i] ?? 1e9) < (h[k][a] ?? 1e9) ? i : a, win[0]);
  const a = [];

  const pp = maxBy("precipitation_probability"), pmm = win.reduce((s, i) => s + (h.precipitation[i] || 0), 0);
  const ppv = h.precipitation_probability[pp];
  if (ppv >= 60 && pmm >= 0.5) a.push(["bad", "비", `${at(pp)} 강수확률 ${ppv}% · 낮 동안 ${pmm.toFixed(1)}mm`]);
  else if (ppv >= 60) a.push(["warn", "비 불확실", `${at(pp)} 강수확률 ${ppv}%인데 예상 강수량은 ${pmm.toFixed(1)}mm · 기관별 비교 탭 확인`]);
  else if (ppv >= 30) a.push(["warn", "비 가능성", `${at(pp)} 강수확률 ${ppv}% · 낮 동안 ${pmm.toFixed(1)}mm`]);

  const g = maxBy("wind_gusts_10m"), gv = h.wind_gusts_10m[g];
  if (gv >= 14) a.push(["bad", "강풍", `${at(g)} 돌풍 ${gv.toFixed(1)}m/s · 드론 비행 금지 수준, 스탠드·프레임 고정`]);
  else if (gv >= 10) a.push(["warn", "드론 주의", `${at(g)} 돌풍 ${gv.toFixed(1)}m/s · 소형 드론 운용 한계에 가까움`]);

  const v = minBy("visibility"), vv = h.visibility[v];
  if (vv != null && vv < 1000) a.push(["warn", "안개", `${at(v)} 시정 ${Math.round(vv)}m · 원경 확보 어려움 (분위기 컷엔 기회)`]);
  else if (vv != null && vv < 5000) a.push(["info", "연무", `${at(v)} 시정 ${(vv / 1000).toFixed(1)}km · 원경 대비 낮음`]);

  const dew = win.find((i) => h.temperature_2m[i] - h.dew_point_2m[i] <= 2 && h.relative_humidity_2m[i] >= 85);
  if (dew != null) a.push(["warn", "결로", `${at(dew)} 기온-이슬점 차 ${(h.temperature_2m[dew] - h.dew_point_2m[dew]).toFixed(1)}° · 렌즈 히터·실리카겔 준비`]);

  const lo = minBy("apparent_temperature"), hi = maxBy("apparent_temperature");
  if (h.apparent_temperature[lo] <= 0) a.push(["warn", "추위", `체감 ${h.apparent_temperature[lo].toFixed(0)}° · 배터리 소모 빠름, 예비 배터리 보온`]);
  if (h.apparent_temperature[hi] >= 31) a.push(["warn", "더위", `체감 ${h.apparent_temperature[hi].toFixed(0)}° · 바디·모니터 과열, 스태프 휴식 계획`]);

  const uv = maxBy("uv_index");
  if (h.uv_index[uv] >= 8) a.push(["info", "자외선", `${at(uv)} UV ${h.uv_index[uv].toFixed(0)} · 매우 높음`]);

  if (!a.length) a.push(["good", "양호", "비·바람·안개 특이사항 없음"]);
  return a;
}

// ── 탭별 렌더 ────────────────────────────────────────────────
function phaseClass(day, hour) {
  const alt = sunAt(atMinuteOf(day, hour * 60 + 30)).alt;
  return alt < -6 ? "night" : alt < -4 ? "blue" : alt < 6 ? "gold" : "day";
}
function atMinuteOf(day, min) { return new Date(dayStartMs(day) + min * 60000); }

function renderHourly() {
  const h = state.wx.hourly, idx = hourIdx(state.date);
  if (!idx.length) return `<p class="empty">이 날짜는 시간별 예보 범위 밖이에요. 16일 이내 날짜를 고르세요.</p>`;
  const bar = (v) => `style="--p:${v ?? 0}%"`;
  return `<div class="scroll"><table class="wx-table hourly">
    <thead><tr><th>시각</th><th>날씨</th><th>기온</th><th>체감</th><th>강수확률</th><th>강수량</th><th>구름</th><th>바람</th><th>돌풍</th><th>습도</th><th>시정</th><th>UV</th></tr></thead>
    <tbody>${idx.map((i) => {
      const hr = +h.time[i].slice(11, 13), ph = phaseClass(state.date, hr);
      const gust = h.wind_gusts_10m[i];
      return `<tr class="ph-${ph}">
        <td class="mono">${String(hr).padStart(2, "0")}:00${ph === "gold" ? '<em class="tag gold">골든</em>' : ph === "blue" ? '<em class="tag blue">블루</em>' : ""}</td>
        <td>${wmoLabel(h.weather_code[i])}</td>
        <td class="mono strong">${num(h.temperature_2m[i], 1)}°</td>
        <td class="mono">${num(h.apparent_temperature[i])}°</td>
        <td class="mono pbar" ${bar(h.precipitation_probability[i])}>${num(h.precipitation_probability[i])}%</td>
        <td class="mono ${h.precipitation[i] > 0 ? "rain" : "dim"}">${num(h.precipitation[i], 1)}</td>
        <td class="mono">${num(h.cloud_cover[i])}%</td>
        <td class="mono">${num(h.wind_speed_10m[i], 1)} <small>${windName(h.wind_direction_10m[i])}</small></td>
        <td class="mono ${gust >= 14 ? "bad" : gust >= 10 ? "warn" : ""}">${num(gust, 1)}</td>
        <td class="mono">${num(h.relative_humidity_2m[i])}%</td>
        <td class="mono ${h.visibility[i] < 1000 ? "warn" : ""}">${h.visibility[i] == null ? "–" : (h.visibility[i] / 1000).toFixed(1)}</td>
        <td class="mono">${num(h.uv_index[i])}</td></tr>`;
    }).join("")}</tbody></table></div>
    <p class="note">단위: 기온 °C · 강수량 mm · 바람/돌풍 m/s · 시정 km</p>`;
}

function renderDaily() {
  const d = state.wx.daily;
  const lo = Math.min(...d.temperature_2m_min), hi = Math.max(...d.temperature_2m_max), span = hi - lo || 1;
  return `<div class="scroll"><table class="wx-table daily">
    <thead><tr><th>날짜</th><th>날씨</th><th class="range-h">최저 · 최고</th><th>강수확률</th><th>강수량</th><th>바람/돌풍</th><th>UV</th><th>일조</th><th>노을 점수</th></tr></thead>
    <tbody>${d.time.map((day, i) => {
      const l = dayLabel(day), t = sunTimes(day);
      const pm = skyScore(wxHour(minuteOf(t.sunset, day), day));
      const left = ((d.temperature_2m_min[i] - lo) / span) * 100, w = ((d.temperature_2m_max[i] - d.temperature_2m_min[i]) / span) * 100;
      return `<tr data-day="${day}" class="${day === state.date ? "sel" : ""}" tabindex="0">
        <td class="mono ${l.wkend ? "wkend" : ""}">${l.text}</td>
        <td>${wmoLabel(d.weather_code[i])}</td>
        <td class="range"><span class="mono">${num(d.temperature_2m_min[i])}°</span><span class="rtrack"><span style="left:${left}%;width:${Math.max(w, 3)}%"></span></span><span class="mono strong">${num(d.temperature_2m_max[i])}°</span></td>
        <td class="mono pbar" style="--p:${d.precipitation_probability_max[i] ?? 0}%">${num(d.precipitation_probability_max[i])}%</td>
        <td class="mono ${d.precipitation_sum[i] > 0 ? "rain" : "dim"}">${num(d.precipitation_sum[i], 1)}</td>
        <td class="mono ${d.wind_gusts_10m_max[i] >= 14 ? "bad" : d.wind_gusts_10m_max[i] >= 10 ? "warn" : ""}">${num(d.wind_speed_10m_max[i], 1)} / ${num(d.wind_gusts_10m_max[i], 1)}</td>
        <td class="mono">${num(d.uv_index_max[i])}</td>
        <td class="mono">${num((d.sunshine_duration[i] ?? 0) / 3600, 1)}h</td>
        <td>${pm ? `<span class="pill sm ${pm.cls}">${pm.s}</span>` : "–"}</td></tr>`;
    }).join("")}</tbody></table></div>
    <p class="note">행을 누르면 그날로 이동해요. 강수량 mm · 바람 m/s · 일조 = 햇빛이 비친 시간</p>`;
}

function renderWeekly() {
  const d = state.wx.daily, weeks = new Map();
  d.time.forEach((day, i) => {
    const dt = new Date(`${day}T12:00:00Z`), monday = new Date(dt - ((dt.getUTCDay() + 6) % 7) * 864e5).toISOString().slice(0, 10);
    if (!weeks.has(monday)) weeks.set(monday, []);
    weeks.get(monday).push(i);
  });
  const names = ["이번 주", "다음 주", "다다음 주", "3주 뒤"];
  return `<div class="weeks">${[...weeks.values()].map((idx, w) => {
    const days = idx.map((i) => d.time[i]);
    const rainy = idx.filter((i) => d.precipitation_sum[i] >= 1 || (d.precipitation_probability_max[i] >= 60 && d.precipitation_sum[i] >= 0.3));
    const windy = idx.filter((i) => d.wind_gusts_10m_max[i] >= 10);
    const avg = (k) => idx.reduce((s, i) => s + d[k][i], 0) / idx.length;
    const rain = idx.reduce((s, i) => s + (d.precipitation_sum[i] || 0), 0);
    const scored = days.map((day) => { const t = sunTimes(day); return { day, s: skyScore(wxHour(minuteOf(t.sunset, day), day)) }; }).filter((x) => x.s);
    const best = scored.sort((a, b) => b.s.s - a.s.s)[0];
    const dry = idx.filter((i) => !rainy.includes(i)).map((i) => dayLabel(d.time[i]).text.split(" ")[0]);
    return `<article class="week">
      <header><h3>${names[w] ?? `${w}주 뒤`}</h3><span class="mono muted">${dayLabel(days[0]).text} – ${dayLabel(days.at(-1)).text}</span></header>
      <div class="week-days">${idx.map((i) => `<button type="button" data-day="${d.time[i]}" class="wd ${wmoKind(d.weather_code[i])}${d.time[i] === state.date ? " sel" : ""}" title="${dayLabel(d.time[i]).text} ${WMO[d.weather_code[i]] ?? ""}"><span>${dayLabel(d.time[i]).text.split(" ")[1].replace(/[()]/g, "")}</span><i></i><b>${num(d.temperature_2m_max[i])}°</b></button>`).join("")}</div>
      <dl class="week-stats">
        <div><dt>평균 기온</dt><dd>${avg("temperature_2m_min").toFixed(0)}° / ${avg("temperature_2m_max").toFixed(0)}°</dd></div>
        <div><dt>비 오는 날</dt><dd>${rainy.length}일 <small>${rain.toFixed(0)}mm</small></dd></div>
        <div><dt>바람 센 날</dt><dd>${windy.length}일</dd></div>
        <div><dt>노을 최고</dt><dd>${best ? `${dayLabel(best.day).text.split(" ")[0]} <small>${best.s.s}점</small>` : "–"}</dd></div>
      </dl>
      <p class="week-note">${rainy.length === 0 ? "비 소식이 없어 야외 촬영하기 좋은 주예요." : rainy.length / idx.length >= 0.6 ? "거의 매일 비 예보가 있어요. 실내 촬영이나 우천 대비 계획을 세우세요." : `비 없는 날: ${dry.join(", ")}`}</p>
    </article>`;
  }).join("")}</div>
  <p class="note">비 오는 날 = 강수량 1mm 이상 (또는 강수확률 60% 이상이면서 0.3mm 이상) · 바람 센 날 = 돌풍 10m/s 이상</p>`;
}

async function loadModels() {
  const key = `${state.lat.toFixed(3)},${state.lon.toFixed(3)}`;
  if (modelCache.has(key)) return modelCache.get(key);
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.search = new URLSearchParams({
    latitude: state.lat, longitude: state.lon, timezone: "auto", forecast_days: 16, wind_speed_unit: "ms",
    models: WX_MODELS.map((m) => m.id).join(","),
    daily: "temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,wind_gusts_10m_max,weather_code",
  });
  const p = fetch(url).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); });
  modelCache.set(key, p);
  p.catch(() => modelCache.delete(key));
  return p;
}

function renderModels(data) {
  if (!data) return `<p class="empty">기관별 예보를 불러오는 중이에요…</p>`;
  const i = data.daily.time.indexOf(state.date);
  if (i < 0) return `<p class="empty">이 날짜는 모델 예보 범위 밖이에요.</p>`;
  const v = (k, m) => data.daily[`${k}_${m.id}`]?.[i];
  const rows = WX_MODELS.map((m) => ({ m, tmax: v("temperature_2m_max", m), tmin: v("temperature_2m_min", m), pp: v("precipitation_probability_max", m), mm: v("precipitation_sum", m), gust: v("wind_gusts_10m_max", m), code: v("weather_code", m) }));
  const has = rows.filter((r) => r.tmax != null);
  const missing = rows.filter((r) => r.tmax == null).map((r) => r.m.name);
  const wet = has.filter((r) => (r.mm ?? 0) >= 1).length;
  const tSpread = has.length ? Math.max(...has.map((r) => r.tmax)) - Math.min(...has.map((r) => r.tmax)) : 0;
  let verdict, cls;
  if (!has.length) { verdict = "이 날짜에 예보를 낸 모델이 없어요."; cls = "none"; }
  else if (wet === 0) { verdict = `${has.length}개 모델 모두 비 없음으로 일치해요.`; cls = "good"; }
  else if (wet === has.length) { verdict = `${has.length}개 모델 모두 비를 예보해요. 우천 대비가 필요해요.`; cls = "bad"; }
  else { verdict = `${has.length}개 중 ${wet}개 모델만 비를 예보해요. 예보가 엇갈려 불확실해요.`; cls = "warn"; }
  return `<p class="verdict ${cls}"><span class="pill ${cls}">${cls === "good" ? "일치" : cls === "bad" ? "비 일치" : cls === "warn" ? "엇갈림" : "없음"}</span>${verdict} 최고기온 차이 ${tSpread.toFixed(1)}°.</p>
    <div class="scroll"><table class="wx-table models">
      <thead><tr><th>모델</th><th>날씨</th><th>최저 / 최고</th><th>강수확률</th><th>강수량</th><th>최대 돌풍</th></tr></thead>
      <tbody>${has.map((r) => `<tr>
        <td><b>${r.m.name}</b> <small class="muted">${r.m.org}</small></td>
        <td>${wmoLabel(r.code)}</td>
        <td class="mono">${num(r.tmin)}° / <span class="strong">${num(r.tmax)}°</span></td>
        <td class="mono">${r.pp == null ? "<small class='muted'>미제공</small>" : `${r.pp}%`}</td>
        <td class="mono ${r.mm > 0 ? "rain" : "dim"}">${num(r.mm, 1)}mm</td>
        <td class="mono ${r.gust >= 14 ? "bad" : r.gust >= 10 ? "warn" : ""}">${num(r.gust, 1)}m/s</td></tr>`).join("")}</tbody></table></div>
    <p class="note">${missing.length ? `${missing.join(", ")}: 이 날짜·위치에 제공되는 값이 없어요. ` : ""}모델마다 예보 기간이 달라서(ICON 약 7일, JMA 약 11일) 먼 날짜일수록 비교 대상이 줄어요.</p>`;
}

let modelsReq = 0;
function renderWeather() {
  const body = $("wxBody"), alerts = $("wxAlerts");
  $("wxWhere").textContent = `· ${state.name} · ${dayLabel(state.date).text}`;
  document.querySelectorAll("#wxTabs button").forEach((b) => b.setAttribute("aria-selected", b.dataset.tab === wxTab));
  if (!state.wx) { alerts.innerHTML = ""; body.innerHTML = `<p class="empty">날씨를 불러오는 중이에요…</p>`; return; }

  const al = shootingAlerts(state.date);
  alerts.innerHTML = al
    ? `<span class="alerts-h">촬영 체크</span>` + al.map(([c, t, d]) => `<span class="alert ${c}"><b>${t}</b>${d}</span>`).join("")
    : "";

  if (wxTab === "hourly") body.innerHTML = renderHourly();
  else if (wxTab === "daily") body.innerHTML = renderDaily();
  else if (wxTab === "weekly") body.innerHTML = renderWeekly();
  else {
    const req = ++modelsReq;
    body.innerHTML = renderModels(null);
    loadModels()
      .then((d) => { if (req === modelsReq && wxTab === "models") body.innerHTML = renderModels(d); })
      .catch(() => { if (req === modelsReq) body.innerHTML = `<p class="empty">기관별 예보를 불러오지 못했어요. 잠시 후 탭을 다시 눌러 주세요.</p>`; });
  }
  $("wxSource").textContent = `출처: Open-Meteo (${state.wx.timezone}) · 마지막 갱신 ${fmt(new Date())}`;
}

function initWeather() {
  $("wxTabs").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-tab]");
    if (!b) return;
    wxTab = b.dataset.tab;
    try { localStorage.setItem("wxTab", wxTab); } catch {}
    renderWeather();
  });
  const pick = (e) => {
    const el = e.target.closest("[data-day]");
    if (!el || !$("wxBody").contains(el)) return;
    state.date = el.dataset.day; $("date").value = state.date; state.minute = null;
    render();
  };
  $("wxBody").addEventListener("click", pick);
  $("wxBody").addEventListener("keydown", (e) => { if (e.key === "Enter") pick(e); });
}
