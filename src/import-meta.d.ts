interface ImportMeta {
  glob<T>(pattern: string, options: { eager: true; import: string }): Record<string, T>
}
