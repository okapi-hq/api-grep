export const any = (hostname: string) => fetch(`https://${hostname}:443/status`);
export const local = () => fetch(`http://127.0.0.1:${process.env.PORT}/health`);
export const dev = (port: number) => fetch(`http://localhost:${port}/api/items`);
export const connector = () => fetch(`https://${process.env.REPLIT_CONNECTORS_HOSTNAME}/api/v2/connection`);
export const regional = (region: string) => fetch(`https://calendar.zoho.${region}/api/v1/events`);
