declare module "m3u8-parser" {
  export class Parser {
    constructor();
    push(data: string): void;
    end(): void;
    manifest: {
      playlists?: Array<{
        uri: string;
        attributes?: {
          BANDWIDTH?: number;
          RESOLUTION?: {
            width: number;
            height: number;
          };
          CODECS?: string;
          AUDIO?: string;
        };
      }>;
      segments?: Array<{
        duration: number;
        uri: string;
      }>;
    };
  }

  const m3u8Parser: {
    Parser: typeof Parser;
  };
  export default m3u8Parser;
}

declare module "ffprobe-static" {
  const ffprobe: {
    path: string;
  };
  export default ffprobe;
}
