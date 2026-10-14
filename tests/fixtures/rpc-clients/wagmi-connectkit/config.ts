import { getDefaultConfig } from "connectkit";
import { createConfig, http } from "wagmi";
import { mainnet } from "wagmi/chains";

const kitConfig = getDefaultConfig({
  appName: "Vaults",
  chains: [mainnet],
  transports: { [mainnet.id]: http("https://eth.example-node.io/v1") },
});

// ConnectKit fills in the connectors; the app adds its own options
export const appConfig = createConfig({ ...kitConfig, ssr: true });

// no transports of its own: ConnectKit gives each chain wagmi's default HTTP transport
export const previewConfig = createConfig(getDefaultConfig({ appName: "Vaults preview", chains: [mainnet] }));
