export {};

declare global {
  interface SubtleCrypto {
    encrypt(
      algorithm: AlgorithmIdentifier | RsaOaepParams | AesCtrParams | AesCbcParams | AesGcmParams,
      key: CryptoKey,
      data: Uint8Array<ArrayBufferLike>,
    ): Promise<ArrayBuffer>;
  }
}

declare module './wabaClinicFlowOutreach' {
  interface WabaClinicFlowOutreachEnv {
    [key: string]: unknown;
  }
}
