/** Published releases, read from GitHub when the site is built (see plugins/releases.ts). */
declare module 'virtual:releases' {
  export type FileKind = 'win-x64' | 'win-arm64' | 'deb' | 'appimage';

  export interface Asset {
    name: string;
    /** Bytes. */
    size: number;
    url: string;
  }

  export interface Release {
    version: string;
    /** ISO date the release was published. */
    date: string;
    notesUrl: string;
    files: Partial<Record<FileKind, Asset>>;
  }

  /** Newest first. Never empty: the build fails without at least one release. */
  const releases: Release[];
  export default releases;
}
