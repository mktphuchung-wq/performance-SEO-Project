declare module "xlsx-populate" {
  const XlsxPopulate: {
    fromBlankAsync(): Promise<unknown>;
    fromDataAsync(data: ArrayBuffer | Uint8Array): Promise<any>;
  };

  export default XlsxPopulate;
}
