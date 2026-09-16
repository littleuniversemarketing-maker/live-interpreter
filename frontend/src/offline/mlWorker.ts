/// <reference lib="webworker" />
// Runs entirely in a Web Worker so model loading/inference never blocks the
// UI thread. Everything here executes on-device via ONNX Runtime Web (WASM,
// falls back automatically if WebGPU isn't available) — no network calls
// once the model files are cached.

import { pipeline, type AutomaticSpeechRecognitionPipeline, type TranslationPipeline } from "@huggingface/transformers";
import { OFFLINE_STT_MODEL, WHISPER_LANGUAGE, planOfflineTranslation } from "./offlineModels";
import type { LanguageCode } from "../types";

type WorkerRequest =
  | { id: string; type: "preload"; from: LanguageCode; to: LanguageCode }
  | { id: string; type: "transcribe"; audio: Float32Array; lang: LanguageCode }
  | { id: string; type: "translate"; text: string; from: LanguageCode; to: LanguageCode };

type WorkerResponse =
  | { id: string; type: "progress"; file: string; progress: number }
  | { id: string; type: "transcribed"; text: string }
  | { id: string; type: "translated"; text: string }
  | { id: string; type: "ready" }
  | { id: string; type: "error"; message: string };

let asrPipeline: AutomaticSpeechRecognitionPipeline | null = null;
const translationPipelines = new Map<string, TranslationPipeline>();

function post(msg: WorkerResponse) {
  (self as unknown as Worker).postMessage(msg);
}

async function getAsrPipeline(id: string) {
  if (!asrPipeline) {
    asrPipeline = (await pipeline("automatic-speech-recognition", OFFLINE_STT_MODEL, {
      progress_callback: (p: any) => {
        if (p.status === "progress") {
          post({ id, type: "progress", file: p.file ?? OFFLINE_STT_MODEL, progress: p.progress ?? 0 });
        }
      },
    })) as AutomaticSpeechRecognitionPipeline;
  }
  return asrPipeline;
}

async function getTranslationPipeline(id: string, model: string) {
  let pipe = translationPipelines.get(model);
  if (!pipe) {
    pipe = (await pipeline("translation", model, {
      progress_callback: (p: any) => {
        if (p.status === "progress") {
          post({ id, type: "progress", file: p.file ?? model, progress: p.progress ?? 0 });
        }
      },
    })) as TranslationPipeline;
    translationPipelines.set(model, pipe);
  }
  return pipe;
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;
  try {
    switch (msg.type) {
      case "preload": {
        await getAsrPipeline(msg.id);
        const plan = planOfflineTranslation(msg.from, msg.to);
        for (const step of plan.steps) {
          await getTranslationPipeline(msg.id, step.model);
        }
        post({ id: msg.id, type: "ready" });
        break;
      }

      case "transcribe": {
        const asr = await getAsrPipeline(msg.id);
        const result: any = await asr(msg.audio, {
          language: WHISPER_LANGUAGE[msg.lang],
          task: "transcribe",
        });
        const text = Array.isArray(result) ? result.map((r) => r.text).join(" ") : result.text;
        post({ id: msg.id, type: "transcribed", text: (text ?? "").trim() });
        break;
      }

      case "translate": {
        const plan = planOfflineTranslation(msg.from, msg.to);
        let text = msg.text;
        for (const step of plan.steps) {
          const pipe = await getTranslationPipeline(msg.id, step.model);
          const result: any = await pipe(text);
          text = Array.isArray(result) ? result[0].translation_text : result.translation_text;
        }
        post({ id: msg.id, type: "translated", text });
        break;
      }
    }
  } catch (err: any) {
    post({ id: msg.id, type: "error", message: err?.message ?? String(err) });
  }
};
