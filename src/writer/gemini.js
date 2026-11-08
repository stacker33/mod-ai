// Minimal Gemini client (REST, JSON output). Key and models come from .env.
// A model that hangs (no answer in 60 s) or is overloaded is skipped for 20 minutes — remembered in
// healthFile between runs — so one stuck model never holds a recap for minutes.

import { readFileSync, writeFileSync } from 'node:fs';

const TIMEOUT = 60e3;
const SKIP_FOR = 20 * 60e3;
const readHealth = (file) => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return {}; } };
function markSlow(file, m, why) {
  if (!file) return;
  const h = readHealth(file);
  h[m] = { until: Date.now() + SKIP_FOR, why };
  try { writeFileSync(file, JSON.stringify(h)); } catch { /* not fatal */ }
}

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

// fallbackHint: extra text for the fallback models only (a code-written skeleton of the story), so a weaker
// model starts from the facts in order instead of from a blank page
export async function generateJSON({ key, model, fallback, system, messages, schema, temperature = 0.5, healthFile = null, fallbackHint = null }) {
  const listed = [model, ...String(fallback || '').split(',')].map((x) => x && x.trim()).filter(Boolean);
  const health = healthFile ? readHealth(healthFile) : {};
  // skip the models that hung / were overloaded in the last 20 minutes (all of them skipped -> try them anyway)
  const fresh = listed.filter((m) => !(health[m]?.until > Date.now()));
  const models = fresh.length ? fresh : listed;
  let lastErr;
  let dailyOut = 0; // models whose daily quota is used up
  for (const m of models) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const r = await fetch(`${BASE}/${m}:generateContent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
          signal: AbortSignal.timeout(TIMEOUT),
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: system }] },
            contents: messages.map((x, i) => ({ role: x.role, parts: [{ text: i === 0 && fallbackHint && m !== listed[0] ? `${x.text}\n\n${fallbackHint}` : x.text }] })),
            generationConfig: { temperature, responseMimeType: 'application/json', responseSchema: schema, maxOutputTokens: 8192 },
          }),
        });
        if (r.status === 429 || r.status >= 500) {
          const body = await r.text();
          lastErr = new Error(`Gemini ${m} ${r.status}: ${body.slice(0, 200)}`);
          if (r.status === 429 && /PerDay|per day|daily/i.test(body)) { dailyOut++; break; } // daily quota (free tier: 20 a day per model): next model
          if (r.status === 503 && attempt >= 2) { markSlow(healthFile, m, '503'); break; } // overloaded: try the next model
          await new Promise((res) => setTimeout(res, 6000 * attempt));
          continue;
        }
        const j = await r.json();
        if (!r.ok) throw new Error(`Gemini ${m} ${r.status}: ${j.error?.message || ''}`);
        const text = j.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
        return { model: m, text, data: JSON.parse(text), usage: j.usageMetadata || null };
      } catch (e) {
        lastErr = e;
        if (/Gemini .* 4\d\d/.test(e.message) && !/429/.test(e.message)) break; // 400/404: this model is not usable, try the next
        // no answer at all: one try is enough — waiting 3 x 60 s on a stuck model is what made recaps late
        if (e.name === 'TimeoutError' || e.name === 'AbortError') { markSlow(healthFile, m, 'timeout'); break; }
        await new Promise((res) => setTimeout(res, 4000 * attempt));
      }
    }
  }
  // every model is out for the day: the caller waits for the reset instead of counting a failure
  if (dailyOut === models.length) lastErr.quota = true;
  throw lastErr;
}
