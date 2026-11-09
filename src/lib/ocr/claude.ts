import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";

import type { CardNotation, OcrPlayerRow } from "./notation";

export const OCR_MODEL = "claude-opus-5-5";

export function isOcrConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

const Cell = z.object({
  confidence: z.enum(["high", "medium", "low"]),
  enclosure: z.enum(["none", "circle", "double_circle", "square", "double_square"]),
  raw: z.string(),
});

const Scorecard = z.object({
  notation: z.enum(["absolute", "relative"]),
  notes: z.string(),
  players: z.array(
    z.object({
      cells: z.array(Cell),
      name: z.string(),
      nameConfidence: z.enum(["high", "medium", "low"]),
    }),
  ),
  printedPars: z.array(z.string()),
});

export type ScorecardReading = {
  notation: CardNotation;
  notes: string;
  players: OcrPlayerRow[];
  printedPars: string[];
};

const SYSTEM = `You transcribe handwritten golf scorecards for a Thai golf club. You are a careful transcriber, not a scorer.

For each player row on the card, report:
- name: the player's name exactly as written (Thai or Latin script, nicknames included).
- cells: exactly 18 entries for holes 1-18 in order. Skip OUT/IN/TOTAL/HCP/NET columns.
  - raw: copy exactly what is written in the cell. Keep digits, signs and letters as written: "5", "+1", "-1", "0", "E", "/", "✓", "B", "Bo", "DB", "X", "NR", "PU", "-". Thai digits (๐-๙) may be copied as written. Use "" for an empty cell.
  - enclosure: the shape drawn around the mark (circle, double_circle, square, double_square) or none.
  - confidence: high only when the mark is unambiguous; medium if two readings are plausible; low if you are guessing.
- nameConfidence: same scale, for the name.

Also report:
- notation: "relative" if the hole cells are written relative to par (+1, -1, 0, E), otherwise "absolute" (stroke counts).
- printedPars: the 18 par values printed on the card, as written, or [] if none are printed.
- notes: anything a human reviewer should know (crossed-out corrections, smudges, missing rows, a 9-hole card), or "".

Never compute or correct scores and never fill a cell you cannot see; uncertainty is expected and is reviewed by a person.`;

/**
 * Read a scorecard photo. Returns the transcription only; conversion to strokes is done
 * by `interpretRow` against the competition's pars.
 */
export async function readScorecard(image: { base64: string; mediaType: "image/jpeg" | "image/png" | "image/webp" }) {
  const client = new Anthropic();
  // Server-side refusal fallback: if a safety classifier declines, the API reruns the
  // request on a suitable model inside the same call.
  const response = await client.beta.messages.parse({
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    max_tokens: 16000,
    messages: [
      {
        content: [
          { source: { data: image.base64, media_type: image.mediaType, type: "base64" }, type: "image" },
          { text: "Transcribe this golf scorecard.", type: "text" },
        ],
        role: "user",
      },
    ],
    model: OCR_MODEL,
    output_config: { effort: "high", format: betaZodOutputFormat(Scorecard) },
    system: SYSTEM,
  });

  if (response.stop_reason === "refusal") {
    throw new Error("OCR_REFUSED");
  }
  if (response.stop_reason === "max_tokens" || !response.parsed_output) {
    throw new Error("OCR_UNREADABLE");
  }

  const parsed = response.parsed_output;
  const reading: ScorecardReading = {
    notation: parsed.notation,
    notes: parsed.notes,
    players: parsed.players.map((player) => ({
      cells: player.cells.slice(0, 18).map((cell) => ({
        confidence: cell.confidence,
        enclosure: cell.enclosure === "none" ? null : cell.enclosure,
        raw: cell.raw,
      })),
      name: player.name,
      nameConfidence: player.nameConfidence,
    })),
    printedPars: parsed.printedPars,
  };

  return {
    model: response.model,
    reading,
    usage: {
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
    },
  };
}
