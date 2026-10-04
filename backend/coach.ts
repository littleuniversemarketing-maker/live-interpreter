import { config } from "./config.js";
import { LANGUAGES } from "./languages.js";
import type { LanguageCode } from "./types.js";

/**
 * "Coach me" is a separate, on-demand feature sitting on top of the core
 * interpreter (which must stay a pure translation engine — see
 * buildInterpreterInstructions in providers/openaiRealtimeProvider.ts).
 * This never touches the live realtime session: it's a plain one-off text
 * (and optional TTS) request, triggered by a button tap, asking "what would
 * a natural reply look like, in their language, so I can say it myself."
 */

export interface CoachRequest {
  /** What the other person said, in their own language. */
  utterance: string;
  utteranceLang: LanguageCode;
  /** Language the suggested reply should be in — normally the same as utteranceLang. */
  replyLang: LanguageCode;
  /** The translation the user already saw, if any — gives the model extra grounding. */
  translatedUtterance?: string;
}

export interface CoachSuggestion {
  reply: string;
  /** Phonetic reading (e.g. romaji) when replyLang isn't in a Latin script. */
  romanization: string | null;
  /** Slow-paced spoken version of `reply`, base64-encoded mp3, for pronunciation practice. */
  audioBase64: string | null;
}

// Languages whose script benefits from a romanized reading alongside it.
const NON_LATIN_SCRIPTS = new Set<LanguageCode>(["ja", "zh", "ko"]);

export async function generateCoachSuggestion(req: CoachRequest): Promise<CoachSuggestion> {
  const replyMeta = LANGUAGES[req.replyLang];
  const utteranceMeta = LANGUAGES[req.utteranceLang];
  const needsRomanization = NON_LATIN_SCRIPTS.has(req.replyLang);

  const promptParts = [
    `Someone just said this in ${utteranceMeta.label}: "${req.utterance}"`,
    req.translatedUtterance ? `In English, that means: "${req.translatedUtterance}"` : "",
    `Suggest ONE short, natural, polite reply in ${replyMeta.label} that a non-native speaker could realistically say back in this conversation. Keep it brief and conversational, not a lesson.`,
    needsRomanization
      ? `Also give a simple phonetic romanization of that reply so an English speaker can read it aloud.`
      : "",
    `Respond with ONLY a JSON object and nothing else, in exactly this shape: {"reply": "...", "romanization": ${
      needsRomanization ? '"..."' : "null"
    }}`,
  ];
  const prompt = promptParts.filter(Boolean).join(" ");

  const chatRes = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.openaiApiKey}`,
    },
    body: JSON.stringify({
      model: config.coachModel,
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0.4,
    }),
  });

  if (!chatRes.ok) {
    const errText = await chatRes.text().catch(() => "");
    throw new Error(`Coach text request failed (${chatRes.status}): ${errText.slice(0, 200)}`);
  }

  const chatJson: any = await chatRes.json();
  const content: string = chatJson.choices?.[0]?.message?.content ?? "{}";

  let parsed: { reply?: string; romanization?: string | null };
  try {
    parsed = JSON.parse(content);
  } catch {
    // Model didn't return clean JSON — fall back to using the raw text as
    // the reply rather than failing the whole request.
    parsed = { reply: content.trim(), romanization: null };
  }

  const reply = (parsed.reply ?? "").trim();
  const romanization = parsed.romanization ? String(parsed.romanization).trim() : null;

  let audioBase64: string | null = null;
  if (reply) {
    try {
      audioBase64 = await synthesizeSlowAudio(reply, req.replyLang);
    } catch (err) {
      // Audio is a nice-to-have on top of the text suggestion — never let a
      // TTS hiccup block the text the user actually needs.
      console.error("Coach TTS failed:", err);
    }
  }

  return { reply, romanization, audioBase64 };
}

async function synthesizeSlowAudio(text: string, lang: LanguageCode): Promise<string> {
  const voice = LANGUAGES[lang].defaultVoice;
  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.openaiApiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini-tts",
      voice,
      input: text,
      speed: 0.75,
      response_format: "mp3",
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`TTS request failed (${res.status}): ${errText.slice(0, 200)}`);
  }

  const buf = Buffer.from(await res.arrayBuffer());
  return buf.toString("base64");
}
