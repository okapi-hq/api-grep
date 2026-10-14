import { getBlockNumber, getGasPrice } from "@wagmi/core";
import { appConfig, previewConfig } from "./config";

export async function head() {
  return getBlockNumber(appConfig);
}

export async function previewGasPrice() {
  return getGasPrice(previewConfig);
}
