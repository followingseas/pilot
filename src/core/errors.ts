export class PilotError extends Error {
  constructor(message: string, readonly hint?: string) {
    super(message)
  }
}

export class ManifestError extends PilotError {
  constructor(readonly file: string, message: string) {
    super(`${file}: ${message}`)
  }
}

export class ConflictError extends PilotError {}
