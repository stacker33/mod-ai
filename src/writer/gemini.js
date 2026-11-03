// Minimal Gemini client (REST, JSON output). Key and models come from .env.

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

export async function generateJSON({ key, model, fallback, system, messages, schema, temperature = 0.5 }) {
  const models = [model, ...String(fallback || '').split(',')].map((x) => x && x.trim()).filter(Boolean);
  let lastErr;
  let dailyOut = 0; // models whose daily quota is used up
  for (const m of models) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const r = await fetch(`${BASE}/${m}:generateContent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
          signal: AbortSignal.timeout(120000),
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: system }] },
            contents: messages.map((x) => ({ role: x.role, parts: [{ text: x.text }] })),
            generationConfig: { temperature, responseMimeType: 'application/json', responseSchema: schema, maxOutputTokens: 8192 },
          }),
        });
        if (r.status === 429 || r.status >= 500) {
          const body = await r.text();
          lastErr = new Error(`Gemini ${m} ${r.status}: ${body.slice(0, 200)}`);
          if (r.status === 429 && /PerDay|per day|daily/i.test(body)) { dailyOut++; break; } // daily quota (free tier: 20 a day per model): next model
          if (r.status === 503 && attempt >= 2) break; // overloaded: try the next model
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
        await new Promise((res) => setTimeout(res, 4000 * attempt));
      }
    }
  }
  // every model is out for the day: the caller waits for the reset instead of counting a failure
  if (dailyOut === models.length) lastErr.quota = true;
  throw lastErr;
}
