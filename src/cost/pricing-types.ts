/** Browser-safe type leaf shared by pricing and the governed engine. */
/** Per-model pricing in USD per 1M tokens. Local models = 0. */
export interface Pricing {
  inPerMTok: number;
  outPerMTok: number;
  known?: boolean;
  source?: string;
  verifiedAt?: string;
}
