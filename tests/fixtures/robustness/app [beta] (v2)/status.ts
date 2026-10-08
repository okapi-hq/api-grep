// The directory name has glob characters: files used to be looked up as patterns and nothing was scanned.
export const status = () => fetch("https://api.github.com/status");
