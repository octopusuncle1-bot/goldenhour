// 골든아워 플래너: SunCalc(태양 계산) + Open-Meteo(구름 예보)

const PRESETS = [
  { name: "서울 광화문", lat: 37.5759, lon: 126.9768 },
  { name: "서울 여의도 한강공원", lat: 37.5283, lon: 126.9341 },
  { name: "강릉 정동진", lat: 37.6906, lon: 129.0342 },
  { name: "부산 해운대", lat: 35.1587, lon: 129.1604 },
  { name: "제주 성산일출봉", lat: 33.4580, lon: 126.9425 },
  { name: "제주 협재해변", lat: 33.3940, lon: 126.2396 },
  { name: "태안 꽃지해변", lat: 36.4995, lon: 126.3353 },
];

// 사진가 기준: 블루아워 −6°~−4°, 골든아워 −4°~6°
SunCalc.addTime(-4, "blueEndAM", "blueStartPM");

const $ = (id) => document.getElementById(id);
const state = {
  name: PRESETS[0].name, lat: PRESETS[0].lat, lon: PRESETS[0].lon,
  date: todayISO(), tz: "Asia/Seoul", offset: 9 * 3600,
  wx: null, minute: null, bestMode: "pm",
};
const wxCache = new Map();

function todayISO() {
  const d = new Date(Date.now() + 9 * 3600e3);
  return d.toISOString().slice(0, 10);
}

// ── 시간 유틸 (로케이션 시간대 기준) ───────────────────────────
function dayStartMs(day = state.date) {
  const [y, m, d] = day.split("-").map(Number);
  return Date.UTC(y, m - 1, d) - state.offset * 1000;
}
function minuteOf(date, day = state.date) { return (date.getTime() - dayStartMs(day)) / 60000; }
function atMinute(min) { return new Date(dayStartMs() + min * 60000); }
function fmt(date) {
  if (!date || isNaN(date)) return "--:--";
  return new Intl.DateTimeFormat("ko-KR", { timeZone: state.tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
}
function fmtMin(min) {
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
function dur(a, b) { return Math.round((b - a) / 60000); }

// ── 태양 ───────────────────────────────────────────────────
function sunTimes(day = state.date) {
  const noon = new Date(dayStartMs(day) + 12 * 3600e3);
  return SunCalc.getTimes(noon, state.lat, state.lon);
}
function sunAt(date) {
  const p = SunCalc.getPosition(date, state.lat, state.lon);
  return {
    az: ((p.azimuth * 180) / Math.PI + 180 + 360) % 360, // 북쪽 0°, 시계방향
    alt: (p.altitude * 180) / Math.PI,
  };
}
function compassName(deg) {
  const n = ["북", "북북동", "북동", "동북동", "동", "동남동", "남동", "남남동", "남", "남남서", "남서", "서남서", "서", "서북서", "북서", "북북서"];
  return n[Math.round(deg / 22.5) % 16];
}

// ── 날씨 ───────────────────────────────────────────────────
async function loadWeather() {
  const key = `${state.lat.toFixed(3)},${state.lon.toFixed(3)}`;
  if (wxCache.has(key)) return wxCache.get(key);
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.search = new URLSearchParams({
    latitude: state.lat, longitude: state.lon, timezone: "auto", forecast_days: 16, wind_speed_unit: "ms",
    hourly: WX_HOURLY.join(","), daily: WX_DAILY.join(","),
  });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
  const data = await res.json();
  wxCache.set(key, data);
  return data;
}
function wxHour(min, day = state.date) {
  if (!state.wx) return null;
  const h = state.wx.hourly;
  const hh = String(Math.min(23, Math.round(min / 60))).padStart(2, "0");
  const i = h.time.indexOf(`${day}T${hh}:00`);
  if (i < 0) return null;
  return {
    low: h.cloud_cover_low[i], mid: h.cloud_cover_mid[i], high: h.cloud_cover_high[i],
    rain: h.precipitation_probability[i], vis: h.visibility[i],
  };
}

// 노을/여명 하늘 점수: 중·상층운은 색을 받아주고, 하층운은 해를 가린다
function skyScore(w) {
  if (!w) return null;
  const upper = Math.max(w.mid, w.high);
  let s = 50;
  if (w.low > 70) s -= 40; else if (w.low > 30) s -= 15; else s += 5;
  if (upper >= 20 && upper <= 70) s += 35; else if (upper < 20) s += 0; else s -= 10;
  if (w.rain > 50) s -= 30; else if (w.rain > 20) s -= 10;
  s = Math.max(0, Math.min(100, s));
  let label, cls, why;
  if (s >= 75) { label = "불타는 하늘 기대"; cls = "good"; }
  else if (s >= 50) { label = "괜찮음"; cls = "good"; }
  else if (s >= 25) { label = "평범"; cls = "warn"; }
  else { label = "어려움"; cls = "bad"; }
  if (w.low > 70) why = `하층운 ${w.low}%가 해를 가릴 가능성이 커요.`;
  else if (upper >= 20 && upper <= 70) why = `중·상층운 ${upper}%가 노을빛을 받아줄 수 있어요.`;
  else if (upper < 20) why = "구름이 거의 없어 깨끗하지만 하늘 색은 단조로울 수 있어요.";
  else why = `윗구름이 ${upper}%로 두꺼워 빛이 약할 수 있어요.`;
  if (w.rain > 50) why += ` 강수확률 ${w.rain}%.`;
  return { s, label, cls, why };
}

// ── 렌더 ───────────────────────────────────────────────────
function renderSession(el, title, mainLabel, mainTime, steps, scoreMin) {
  const sc = skyScore(wxHour(scoreMin));
  el.innerHTML = `
    <header>
      <div><h2>${title}</h2><div class="when">${fmt(mainTime)}<small>${mainLabel}</small></div></div>
    </header>
    <ol class="steps">${steps.map(([c, t, l]) => `<li><span class="dot ${c}"></span><span class="t">${fmt(t)}</span><span class="lbl">${l}</span></li>`).join("")}</ol>
    <div class="score">
      ${sc ? `<span class="pill ${sc.cls}">${sc.s} · ${sc.label}</span><p>${sc.why}</p>`
           : `<span class="pill none">예보 없음</span><p>${state.wx ? "16일 이내 날짜만 구름 예보가 있어요." : "구름 예보를 불러오는 중이에요."}</p>`}
    </div>`;
}

function renderSessions(t) {
  renderSession($("am"), "아침 세션", "일출", t.sunrise, [
    ["blue", t.dawn, `블루아워 시작 · ${dur(t.dawn, t.blueEndAM)}분`],
    ["gold", t.blueEndAM, `골든아워 시작 · ${dur(t.blueEndAM, t.goldenHourEnd)}분`],
    ["sun", t.sunrise, `일출 · ${compassName(sunAt(t.sunrise).az)} ${sunAt(t.sunrise).az.toFixed(0)}°`],
    ["gold", t.goldenHourEnd, "골든아워 끝 (고도 6°)"],
  ], minuteOf(t.sunrise));
  renderSession($("pm"), "저녁 세션", "일몰", t.sunset, [
    ["gold", t.goldenHour, `골든아워 시작 · ${dur(t.goldenHour, t.blueStartPM)}분`],
    ["sun", t.sunset, `일몰 · ${compassName(sunAt(t.sunset).az)} ${sunAt(t.sunset).az.toFixed(0)}°`],
    ["blue", t.blueStartPM, `블루아워 시작 · ${dur(t.blueStartPM, t.dusk)}분`],
    ["blue", t.dusk, "블루아워 끝 (시민박명 종료)"],
  ], minuteOf(t.sunset));
}

const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
function phaseColor(alt) {
  if (alt < -6) return css("--night");
  if (alt < -4) return css("--blue");
  if (alt < 6) return css("--gold");
  return css("--day");
}

function renderTimeline() {
  const W = 960, L = 70, R = 10, PW = W - L - R;
  const x = (min) => L + (min / 1440) * PW;
  let s = "";
  // 빛 띠 + 고도 곡선
  const BAND_Y = 10, BAND_H = 90;
  let path = "";
  for (let m = 0; m < 1440; m += 5) {
    const { alt } = sunAt(atMinute(m + 2.5));
    s += `<rect x="${x(m)}" y="${BAND_Y}" width="${PW / 288 + 0.6}" height="${BAND_H}" fill="${phaseColor(alt)}"/>`;
    const y = BAND_Y + BAND_H / 2 - (alt / 90) * (BAND_H / 2);
    path += `${m ? "L" : "M"}${x(m).toFixed(1)},${y.toFixed(1)}`;
  }
  s += `<line x1="${L}" x2="${W - R}" y1="${BAND_Y + BAND_H / 2}" y2="${BAND_Y + BAND_H / 2}" stroke="${css("--fg")}" stroke-opacity=".25" stroke-dasharray="3 3"/>`;
  s += `<path d="${path}" fill="none" stroke="${css("--fg")}" stroke-width="1.5"/>`;
  s += `<text x="${L - 8}" y="${BAND_Y + 12}" text-anchor="end">태양</text><text x="${L - 8}" y="${BAND_Y + BAND_H / 2 + 4}" text-anchor="end">0°</text>`;

  // 구름 히트맵
  const rows = [["상층운", "high"], ["중층운", "mid"], ["하층운", "low"], ["강수%", "rain"]];
  const ROW_Y = 112, ROW_H = 18;
  rows.forEach(([label, k], r) => {
    const y = ROW_Y + r * (ROW_H + 4);
    s += `<text x="${L - 8}" y="${y + 13}" text-anchor="end">${label}</text>`;
    s += `<rect x="${L}" y="${y}" width="${PW}" height="${ROW_H}" fill="${css("--line")}" fill-opacity=".35"/>`;
    for (let h = 0; h < 24; h++) {
      const w = wxHour(h * 60);
      if (!w) continue;
      const v = w[k] ?? 0;
      const color = k === "rain" ? css("--blue") : css("--muted");
      s += `<rect x="${x(h * 60) + 1}" y="${y}" width="${PW / 24 - 2}" height="${ROW_H}" fill="${color}" fill-opacity="${(v / 100).toFixed(2)}"><title>${String(h).padStart(2, "0")}시 ${label} ${v}%</title></rect>`;
    }
  });

  // 시간 눈금
  for (let h = 0; h <= 24; h += 3) {
    s += `<line x1="${x(h * 60)}" x2="${x(h * 60)}" y1="${BAND_Y}" y2="204" stroke="${css("--fg")}" stroke-opacity=".08"/>`;
    s += `<text x="${x(h * 60)}" y="222" text-anchor="middle">${String(h).padStart(2, "0")}</text>`;
  }
  // 스크럽 커서
  s += `<line id="cursor" x1="${x(state.minute)}" x2="${x(state.minute)}" y1="4" y2="208" stroke="${css("--fg")}" stroke-width="1.5"/>`;
  $("timeline").innerHTML = s;
}

function renderCompass(t) {
  const r = 100, pt = (az, rr = r) => [Math.sin((az * Math.PI) / 180) * rr, -Math.cos((az * Math.PI) / 180) * rr];
  let s = `<circle r="${r}" fill="none" stroke="${css("--line")}" stroke-width="2"/>`;
  s += `<circle r="${r * 0.5}" fill="none" stroke="${css("--line")}" stroke-dasharray="2 4"/>`;
  for (let a = 0; a < 360; a += 15) {
    const [x1, y1] = pt(a, r - (a % 90 ? 4 : 9)), [x2, y2] = pt(a, r);
    s += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${css("--muted")}"/>`;
  }
  [["N", 0], ["E", 90], ["S", 180], ["W", 270]].forEach(([l, a]) => { const [x, y] = pt(a, r + 16); s += `<text x="${x}" y="${y}">${l}</text>`; });

  // 낮 동안의 태양 궤적 (중심 = 천정, 원 = 지평선)
  let d = "";
  for (let m = minuteOf(t.sunrise); m <= minuteOf(t.sunset); m += 10) {
    const p = sunAt(atMinute(m));
    const [x, y] = pt(p.az, r * (1 - Math.max(0, p.alt) / 90));
    d += `${d ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
  }
  s += `<path d="${d}" fill="none" stroke="${css("--gold")}" stroke-width="2" stroke-opacity=".7"/>`;
  const ray = (date, color, label) => {
    const az = sunAt(date).az, [x, y] = pt(az), [lx, ly] = pt(az, r * 0.72);
    s += `<line x1="0" y1="0" x2="${x}" y2="${y}" stroke="${color}" stroke-width="2"/>`;
    s += `<text x="${lx}" y="${ly}" style="fill:${color}">${label}</text>`;
  };
  ray(t.sunrise, css("--blue"), "일출");
  ray(t.sunset, css("--bad"), "일몰");
  const now = sunAt(atMinute(state.minute));
  const [sx, sy] = pt(now.az, r * (1 - Math.max(0, now.alt) / 90));
  s += `<circle cx="${sx}" cy="${sy}" r="8" fill="${now.alt > 0 ? css("--gold") : css("--muted")}" stroke="${css("--surface")}" stroke-width="2"/>`;
  $("compass").innerHTML = s;
}

function renderReadout() {
  const date = atMinute(state.minute), p = sunAt(date), w = wxHour(state.minute);
  $("timeOut").textContent = fmtMin(state.minute);
  $("rAz").textContent = `${p.az.toFixed(1)}° ${compassName(p.az)}`;
  $("rAlt").textContent = `${p.alt.toFixed(1)}°`;
  $("rShadow").textContent = p.alt > 0.5 ? `키의 ${(1 / Math.tan((p.alt * Math.PI) / 180)).toFixed(1)}배` : "해 없음";
  $("rCloud").textContent = w ? `${w.low}/${w.mid}/${w.high}%` : "–";
}

function renderCallsheet(t) {
  const am = skyScore(wxHour(minuteOf(t.sunrise))), pm = skyScore(wxHour(minuteOf(t.sunset)));
  $("callsheet").value = [
    `[${state.date}] ${state.name} (${state.lat.toFixed(4)}, ${state.lon.toFixed(4)})`,
    ``,
    `AM 블루아워  ${fmt(t.dawn)}–${fmt(t.blueEndAM)}`,
    `AM 골든아워  ${fmt(t.blueEndAM)}–${fmt(t.goldenHourEnd)}`,
    `일출        ${fmt(t.sunrise)}  방위 ${sunAt(t.sunrise).az.toFixed(0)}° ${compassName(sunAt(t.sunrise).az)}${am ? `  하늘 ${am.s}점` : ""}`,
    `PM 골든아워  ${fmt(t.goldenHour)}–${fmt(t.blueStartPM)}`,
    `일몰        ${fmt(t.sunset)}  방위 ${sunAt(t.sunset).az.toFixed(0)}° ${compassName(sunAt(t.sunset).az)}${pm ? `  하늘 ${pm.s}점` : ""}`,
    `PM 블루아워  ${fmt(t.blueStartPM)}–${fmt(t.dusk)}`,
  ].join("\n");
}

// ── 베스트 촬영일 ──────────────────────────────────────────
function rankDays() {
  if (!state.wx) return [];
  const days = [...new Set(state.wx.hourly.time.map((s) => s.slice(0, 10)))];
  return days.map((day) => {
    const t = sunTimes(day);
    const am = skyScore(wxHour(minuteOf(t.sunrise, day), day));
    const pm = skyScore(wxHour(minuteOf(t.sunset, day), day));
    const pick = state.bestMode === "am" ? am : state.bestMode === "pm" ? pm : (am?.s ?? -1) >= (pm?.s ?? -1) ? am : pm;
    return { day, t, am, pm, pick, pickIsAm: pick === am };
  }).filter((d) => d.pick);
}

function dayLabel(day) {
  const d = new Date(`${day}T12:00:00Z`);
  const wd = "일월화수목금토"[d.getUTCDay()];
  return { text: `${d.getUTCMonth() + 1}/${d.getUTCDate()} (${wd})`, wkend: d.getUTCDay() === 0 || d.getUTCDay() === 6 };
}

function renderBest() {
  const list = $("bestList"), sum = $("bestSummary");
  document.querySelectorAll("#bestSeg button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.mode === state.bestMode));
  const rows = rankDays();
  if (!rows.length) {
    list.innerHTML = "";
    sum.textContent = state.wx ? "이 위치는 구름 예보가 없어요." : "구름 예보를 불러오는 중이에요.";
    return;
  }
  const ranked = [...rows].sort((a, b) => b.pick.s - a.pick.s);
  const rankOf = new Map(ranked.slice(0, 3).map((r, i) => [r.day, i + 1]));
  const best = ranked[0];
  const bl = dayLabel(best.day);
  const when = best.pickIsAm ? `아침 일출 ${fmt(best.t.sunrise)}` : `저녁 일몰 ${fmt(best.t.sunset)}`;
  sum.innerHTML = `가장 좋은 날은 <strong>${bl.text}</strong> ${when}, 하늘 점수 <strong>${best.pick.s}점</strong>이에요. ${best.pick.why}`;

  const bar = (k, sc, active) => sc
    ? `<span class="bar${active ? "" : " dim"}"><span class="k">${k}</span><span class="track"><span class="fill ${sc.cls}" style="width:${Math.max(4, sc.s)}%"></span></span><span class="v">${sc.s}</span></span>`
    : `<span class="bar dim"><span class="k">${k}</span><span class="track"></span><span class="v">–</span></span>`;
  list.innerHTML = `<li class="head"><span>날짜</span><span>아침</span><span>저녁</span><span>순위</span></li>` + rows.map((r) => {
    const l = dayLabel(r.day), rk = rankOf.get(r.day);
    const amOn = state.bestMode !== "pm" && (state.bestMode === "am" || r.pickIsAm);
    const pmOn = state.bestMode !== "am" && (state.bestMode === "pm" || !r.pickIsAm);
    return `<li><button type="button" data-day="${r.day}" class="${r.day === state.date ? "sel" : ""}">
      <span class="d${l.wkend ? " wkend" : ""}">${l.text}</span>${bar("AM", r.am, amOn)}${bar("PM", r.pm, pmOn)}
      <span>${rk ? `<span class="rank">${rk}</span>` : ""}</span></button></li>`;
  }).join("");
  list.querySelectorAll("button[data-day]").forEach((b) => b.onclick = () => {
    state.date = b.dataset.day; $("date").value = state.date; state.minute = null;
    const r = rows.find((x) => x.day === state.date);
    if (r) state.minute = Math.round(minuteOf(r.pickIsAm ? r.t.sunrise : r.t.sunset) / 5) * 5;
    render();
  });
}

function render() {
  renderBest();
  renderWeather();
  const t = sunTimes();
  if (state.minute == null) state.minute = Math.round(minuteOf(t.sunset) / 5) * 5;
  $("time").value = state.minute;
  renderSessions(t);
  renderTimeline();
  renderCompass(t);
  renderReadout();
  renderCallsheet(t);
}

async function refresh() {
  state.wx = null;
  $("wxNote").textContent = "구름 예보를 불러오는 중…";
  render();
  try {
    const wx = await loadWeather();
    state.wx = wx;
    state.tz = wx.timezone;
    state.offset = wx.utc_offset_seconds;
    const has = wx.hourly.time.some((s) => s.startsWith(state.date));
    $("wxNote").textContent = has
      ? `구름 예보: Open-Meteo · 시간대 ${wx.timezone} · 칸에 마우스를 올리면 값이 보여요.`
      : "선택한 날짜는 예보 범위(16일) 밖이에요. 태양 시간만 표시해요.";
  } catch (e) {
    $("wxNote").textContent = `예보를 불러오지 못했어요 (${e.message}). 네트워크를 확인하세요. 태양 시간은 정상이에요.`;
  }
  render();
}

// ── 장소 검색 (OpenStreetMap Nominatim) ─────────────────────
// 이용 정책: 초당 1회 이하, 자동완성 금지 → 버튼/Enter로만 검색
const TYPE_RANK = ["natural", "tourism", "historic", "leisure", "man_made", "place", "boundary", "railway", "aerialway", "building", "highway", "amenity"];
const TYPE_LABEL = {
  natural: "자연", tourism: "관광지", historic: "유적", leisure: "공원", man_made: "랜드마크", place: "지역",
  boundary: "행정구역", building: "건물", amenity: "시설", railway: "역", aerialway: "케이블카", highway: "도로",
};
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

async function nominatim(q, kr) {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.search = new URLSearchParams({ q, format: "jsonv2", limit: 10, addressdetails: 1, "accept-language": "ko", ...(kr ? { countrycodes: "kr" } : {}) });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  return res.json();
}

async function geocode(q) {
  let raw = await nominatim(q, true); // 국내 우선
  if (!raw.length) { await new Promise((r) => setTimeout(r, 1000)); raw = await nominatim(q, false); }
  const seen = new Set();
  return raw
    .map((x) => {
      const a = x.address || {};
      const area = [a.city || a.town || a.county || a.borough, a.province || a.state, a.country_code !== "kr" ? a.country : ""]
        .filter((v, i, arr) => v && arr.indexOf(v) === i).join(", ");
      return { name: x.name || x.display_name.split(",")[0], area, lat: +x.lat, lon: +x.lon,
        cat: x.category, type: TYPE_LABEL[x.category] || "장소" };
    })
    .filter((p) => {
      const k = `${p.name}|${p.lat.toFixed(2)}|${p.lon.toFixed(2)}`;
      return seen.has(k) ? false : seen.add(k);
    })
    .sort((a, b) => (TYPE_RANK.indexOf(a.cat) + 1 || 99) - (TYPE_RANK.indexOf(b.cat) + 1 || 99))
    .slice(0, 6);
}

// ── 입력 ───────────────────────────────────────────────────
function setLocation(name, lat, lon) {
  Object.assign(state, { name, lat: +lat, lon: +lon });
  try { localStorage.setItem("lastLocation", JSON.stringify({ name: state.name, lat: state.lat, lon: state.lon })); } catch {}
  $("lat").value = state.lat; $("lon").value = state.lon;
  refresh();
}

// 아이폰 GPS로 현재 위치 (HTTPS 또는 localhost에서만 동작)
function initGeo() {
  const btn = $("geoBtn");
  if (!navigator.geolocation || !window.isSecureContext || location.protocol === "file:") return;
  btn.hidden = false;
  btn.onclick = () => {
    btn.disabled = true; btn.textContent = "찾는 중…";
    navigator.geolocation.getCurrentPosition(async (pos) => {
      const { latitude: lat, longitude: lon } = pos.coords;
      let name = "현재 위치";
      try {
        const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=16&accept-language=ko&lat=${lat}&lon=${lon}`;
        const r = await (await fetch(url)).json(), a = r.address || {};
        const area = a.city || a.town || a.county || a.borough || a.state;
        const spot = r.name || a.neighbourhood || a.quarter || a.suburb || a.village;
        name = `현재 위치 · ${[spot, area].filter(Boolean).filter((v, i, x) => x.indexOf(v) === i).join(", ") || "이름 없음"}`;
      } catch {}
      $("preset").value = "custom";
      setLocation(name, lat, lon);
      btn.disabled = false; btn.textContent = "현재 위치";
    }, (err) => {
      btn.disabled = false; btn.textContent = "현재 위치";
      $("wxNote").textContent = err.code === 1
        ? "위치 권한이 꺼져 있어요. 설정 → 개인정보 보호 → 위치 서비스 → Safari 웹 사이트에서 허용해 주세요."
        : "현재 위치를 찾지 못했어요. 잠시 후 다시 시도해 주세요.";
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
  };
}

function init() {
  $("preset").innerHTML = PRESETS.map((p, i) => `<option value="${i}">${p.name}</option>`).join("") + `<option value="custom">직접 입력</option>`;
  try {
    const last = JSON.parse(localStorage.getItem("lastLocation") || "null");
    if (last && isFinite(last.lat) && isFinite(last.lon)) {
      Object.assign(state, last);
      const i = PRESETS.findIndex((p) => p.name === last.name);
      $("preset").value = i >= 0 ? i : "custom";
    }
  } catch {}
  initGeo();
  $("preset").onchange = (e) => { const p = PRESETS[e.target.value]; if (p) setLocation(p.name, p.lat, p.lon); };
  $("lat").value = state.lat; $("lon").value = state.lon; $("date").value = state.date;
  const onCoord = () => {
    const lat = parseFloat($("lat").value), lon = parseFloat($("lon").value);
    if (isNaN(lat) || isNaN(lon)) return;
    $("preset").value = "custom";
    setLocation(`${lat.toFixed(4)}, ${lon.toFixed(4)}`, lat, lon);
  };
  $("lat").onchange = onCoord; $("lon").onchange = onCoord;
  $("date").onchange = (e) => { if (e.target.value) { state.date = e.target.value; state.minute = null; refresh(); } };
  $("time").oninput = (e) => { state.minute = +e.target.value; renderTimeline(); renderCompass(sunTimes()); renderReadout(); };

  let searching = false;
  const search = async () => {
    const q = $("search").value.trim(), list = $("results");
    if (!q || searching) return;
    searching = true; $("searchBtn").disabled = true;
    list.hidden = false; list.innerHTML = `<li><small>검색 중…</small></li>`;
    try {
      const places = await geocode(q);
      if (!places.length) { list.innerHTML = `<li><small>"${esc(q)}"에 맞는 장소가 없어요. 지명이나 랜드마크 이름으로 다시 검색해 보세요.</small></li>`; return; }
      list.innerHTML = places.map((p, i) => `<li><button type="button" data-i="${i}"><span class="r-name">${esc(p.name)}<em>${p.type}</em></span><small>${esc(p.area)}</small></button></li>`).join("");
      list.querySelectorAll("button").forEach((b) => b.onclick = () => {
        const p = places[b.dataset.i];
        list.hidden = true; $("preset").value = "custom"; $("search").value = p.name;
        setLocation(p.area ? `${p.name} · ${p.area.split(", ")[0]}` : p.name, p.lat, p.lon);
      });
    } catch {
      list.innerHTML = `<li><small>검색에 실패했어요. 잠시 후 다시 시도하거나 위도·경도를 직접 입력하세요.</small></li>`;
    } finally {
      searching = false; $("searchBtn").disabled = false;
    }
  };
  $("searchBtn").onclick = search;
  $("search").onkeydown = (e) => {
    if (e.key === "Enter" && !e.isComposing) search(); // 한글 입력 조합 중 Enter는 무시
    if (e.key === "Escape") $("results").hidden = true;
  };
  document.addEventListener("click", (e) => { if (!e.target.closest(".field.grow")) $("results").hidden = true; });

  $("copyBtn").onclick = async () => {
    try { await navigator.clipboard.writeText($("callsheet").value); $("copyBtn").textContent = "복사했어요"; }
    catch { $("callsheet").select(); $("copyBtn").textContent = "선택됨 · ⌘C로 복사"; }
    setTimeout(() => ($("copyBtn").textContent = "콜시트용 텍스트 복사"), 1800);
  };
  document.querySelectorAll("#bestSeg button").forEach((b) => b.onclick = () => { state.bestMode = b.dataset.mode; renderBest(); });
  initWeather();
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", render);
  refresh();
}

init();

// 홈 화면 앱: 오프라인에서도 화면이 열리도록 서비스 워커 등록
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
