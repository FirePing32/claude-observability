/** Server-side twin of the collector's error classifier, for OTel `api_error` events. */
export function classifyReasonLite(status: string | null, text: string): string {
  if (/prompt is too long|context.{0,20}(too long|exceed)/i.test(text)) return "prompt_too_long";
  if (status === "401" || status === "403" || /auth|login|oauth/i.test(text)) return "auth";
  if (status === "529" || /overloaded/i.test(text)) return "overloaded";
  if (status === "429" || /rate.?limit/i.test(text)) return "rate_limit";
  if (!status || /socket|network|ECONN|timed? ?out|fetch failed|connection/i.test(text)) return "network";
  return "other";
}
