// An import whose module specifier is not a string literal: a grammar error that used to stop the whole scan.
import { settings } from config;

export const ping = () => fetch(`${settings.url}/ping`);
