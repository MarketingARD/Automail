// Erreur normalisée d'un fournisseur IA, pour que le moteur cascade sache
// combien de temps mettre un fournisseur en pause avant d'essayer le suivant.
export class ProviderError extends Error {
  /**
   * @param {string} message
   * @param {object} opts
   * @param {'rate_limit'|'quota'|'auth'|'unavailable'|'bad_response'|'error'} opts.kind
   * @param {number|null} opts.retryAfterMs  pause explicite (sinon défaut selon kind)
   * @param {number|null} opts.status        code HTTP éventuel
   */
  constructor(message, { kind = 'error', retryAfterMs = null, status = null } = {}) {
    super(message);
    this.name = 'ProviderError';
    this.kind = kind;
    this.retryAfterMs = retryAfterMs;
    this.status = status;
  }
}

// Pause par défaut selon le type d'échec (ms).
const DEFAULT_COOLDOWN = {
  rate_limit: 60_000,        // 1 min — quota par minute typiquement
  quota: 6 * 3600_000,       // 6 h — quota journalier épuisé
  auth: 3600_000,            // 1 h — clé invalide, ne pas marteler
  unavailable: 30_000,       // 30 s — 5xx / réseau
  bad_response: 45_000,      // 45 s — réponse illisible
  error: 30_000,
};

export function cooldownMs(err) {
  if (err instanceof ProviderError) {
    if (err.retryAfterMs != null) return Math.min(err.retryAfterMs, 24 * 3600_000);
    return DEFAULT_COOLDOWN[err.kind] ?? DEFAULT_COOLDOWN.error;
  }
  return DEFAULT_COOLDOWN.error;
}
