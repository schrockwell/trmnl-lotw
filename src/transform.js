// LOTW recent QSL activity -> stats + list
// fetches lotwreport.adi directly (ADIF plaintext isn't preserved by TRMNL polling)

function parseAdif(text) {
  const eoh = text.search(/<eoh>/i);
  const body = eoh >= 0 ? text.slice(eoh + 5) : text;

  function parseBlock(block) {
    const rec = {};
    const re = /<([A-Za-z0-9_]+):(\d+)(?::[^>]*)?>/g;
    let m;
    while ((m = re.exec(block)) !== null) {
      rec[m[1].toUpperCase()] = block.substr(m.index + m[0].length, parseInt(m[2], 10)).trim();
    }
    return rec;
  }

  const records = [];
  for (const chunk of body.split(/<eor>/i)) {
    const rec = parseBlock(chunk);
    if (Object.keys(rec).length > 0) records.push(rec);
  }
  return records;
}

function fmtAdifDate(d) {
  if (!d || d.length < 8) return "";
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return months[parseInt(d.slice(4, 6), 10) - 1] + " " + parseInt(d.slice(6, 8), 10);
}

const SMALL_WORDS = new Set(["of", "the", "and"]);
function titleCase(s) {
  return s.toLowerCase().split(/\s+/).map((w, i) =>
    SMALL_WORDS.has(w) && i > 0 ? w : w.charAt(0).toUpperCase() + w.slice(1)
  ).join(" ");
}

async function run(input) {
  const out = {
    stats: { confirmations: 0, entities: 0, band_slots: 0, modes: 0 },
    qsos: [],
    window_days: 90,
    last_qsl_date: "",
    account_call: "",
    creds_source: "",
    error: ""
  };

  try {
    const cf = (input.trmnl && input.trmnl.plugin_settings && input.trmnl.plugin_settings.custom_fields_values) || {};
    const user = cf.lotw_username || "";
    const pass = cf.lotw_password || "";
    out.creds_source = user ? "custom_fields" : "missing";
    if (!user || !pass) {
      out.error = "enter your LoTW username and password in the plugin settings";
      return out;
    }

    const ownCall = (cf.own_call || "").trim().toUpperCase();
    const days = parseInt(cf.lookback_days, 10) || 90;
    out.window_days = days;
    out.account_call = ownCall || user.toUpperCase();

    const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    let url = "https://lotw.arrl.org/lotwuser/lotwreport.adi?login=" + encodeURIComponent(user) +
      "&password=" + encodeURIComponent(pass) +
      "&qso_query=1&qso_qsl=yes&qso_qsldetail=yes&qso_qslsince=" + since;
    if (ownCall) url += "&qso_owncall=" + encodeURIComponent(ownCall);

    const text = await fetch(url).then(r => r.text());

    if (!/<eoh>/i.test(text)) {
      out.error = "LOTW error: " + text.replace(/<[^>]*>/g, " ").trim().slice(0, 140);
      return out;
    }

    const records = parseAdif(text).filter(r => r.CALL);

    const entities = new Set(), slots = new Set(), modes = new Set();
    for (const r of records) {
      const ent = r.DXCC || r.COUNTRY;
      if (ent) {
        entities.add(ent);
        if (r.BAND) slots.add(ent + "|" + r.BAND.toUpperCase());
      }
      if (r.MODE) modes.add(r.MODE.toUpperCase());
    }

    const qsos = records
      .map(r => ({
        call: r.CALL,
        band: (r.BAND || "").toUpperCase(),
        mode: r.MODE || "",
        country: titleCase(r.COUNTRY || ""),
        qsl_date_fmt: fmtAdifDate(r.QSLRDATE),
        qso_date_fmt: fmtAdifDate(r.QSO_DATE),
        rx: r.APP_LOTW_RXQSL || r.QSLRDATE || ""
      }))
      .sort((a, b) => (b.rx > a.rx ? 1 : b.rx < a.rx ? -1 : 0));

    out.stats = {
      confirmations: records.length,
      entities: entities.size,
      band_slots: slots.size,
      modes: modes.size
    };
    out.last_qsl_date = qsos.length ? qsos[0].qsl_date_fmt : "";
    out.qsos = qsos.slice(0, 25);
  } catch (e) {
    out.error = String(e);
  }

  return out;
}