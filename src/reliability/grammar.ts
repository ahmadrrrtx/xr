/**
 * XR — GBNF grammar builder for the agent's tool-call envelope.
 *
 * Local models (via Ollama / llama.cpp) are bad at producing valid JSON tool
 * calls. By passing a GBNF grammar, the runtime CONSTRAINS generation at the
 * token level: invalid tokens get zero probability, so the model *cannot*
 * produce malformed output — 100% valid envelopes regardless of model size.
 * (TRD §3.2 — the Local-Model Reliability Harness.)
 *
 * We generate a grammar for our envelope:
 *   {"message": <string>, "tool_calls": [ {"tool": <enum>, "args": <object>} ], "done": <bool>}
 */

/**
 * Build a GBNF grammar that forces the model's reply into our envelope shape,
 * restricting "tool" to the actual available tool names.
 */
export function buildEnvelopeGBNF(toolNames: string[]): string {
  // Quote each tool name as a literal GBNF string alternative.
  const toolAlt =
    toolNames.length > 0
      ? toolNames.map((n) => `"\\"${escapeGBNF(n)}\\""`).join(" | ")
      : `string`; // no tools → any string (model will just talk)

  return `
root        ::= "{" ws "\\"message\\"" ws ":" ws string ws "," ws
                "\\"tool_calls\\"" ws ":" ws toolcalls ws "," ws
                "\\"done\\"" ws ":" ws boolean ws "}"

toolcalls   ::= "[" ws "]" | "[" ws toolcall (ws "," ws toolcall)* ws "]"
toolcall    ::= "{" ws "\\"tool\\"" ws ":" ws toolname ws "," ws
                "\\"args\\"" ws ":" ws object ws "}"
toolname    ::= ${toolAlt}

object      ::= "{" ws "}" | "{" ws pair (ws "," ws pair)* ws "}"
pair        ::= string ws ":" ws value
array       ::= "[" ws "]" | "[" ws value (ws "," ws value)* ws "]"
value       ::= string | number | object | array | boolean | "null"

string      ::= "\\"" ( [^"\\\\] | "\\\\" . )* "\\""
number      ::= "-"? [0-9]+ ("." [0-9]+)?
boolean     ::= "true" | "false"
ws          ::= [ \\t\\n]*
`.trim();
}

function escapeGBNF(s: string): string {
  return s.replace(/[\\"]/g, "\\$&");
}
