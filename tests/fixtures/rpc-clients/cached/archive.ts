import { JsonRpcProvider } from "ethers";

const ARCHIVE_URL = "https://archive.example-node.io/rpc";
const archives = new Map<string, JsonRpcProvider>();

// every entry is built with the same URL
function archiveNode(label: string): JsonRpcProvider {
  let node = archives.get(label);
  if (!node) {
    node = new JsonRpcProvider(ARCHIVE_URL);
    archives.set(label, node);
  }
  return node;
}

export async function pastBalance(owner: string, block: number) {
  return archiveNode("main").getBalance(owner, block);
}
