import { Project, type Expression } from "ts-morph";
import { describe, expect, it } from "vitest";
import { readsOnly } from "../../src/detect/contract-abi.js";

function abiOf(source: string): Expression {
  const sf = new Project({ useInMemoryFileSystem: true }).createSourceFile("abi.ts", source);
  return sf.getVariableDeclarationOrThrow("probe").getInitializerOrThrow();
}

describe("readsOnly (#78)", () => {
  it("reads human-readable signatures, through a constant and `new Interface(...)`", () => {
    const src = 'const abi = ["function balanceOf(address owner) external view returns (uint256)", "function transfer(address to, uint256 v) returns (bool)"]; const probe = new Interface(abi);';
    expect(readsOnly(abiOf(src), "balanceOf")).toBe(true);
    expect(readsOnly(abiOf(src), "transfer")).toBe(false);
    expect(readsOnly(abiOf(src), "transfer(address,uint256)")).toBe(false);
    expect(readsOnly(abiOf(src), "approve")).toBeUndefined();
  });

  it("reads JSON fragments, `constant` too, and leaves disagreeing overloads unknown", () => {
    const src = `const probe = [
      { type: "function", name: "total", stateMutability: "pure" },
      { name: "owner", constant: true },
      { type: "event", name: "deposit" },
      { type: "function", name: "deposit", stateMutability: "payable" },
      { type: "function", name: "swap", stateMutability: "view" },
      { type: "function", name: "swap", stateMutability: "nonpayable" },
    ] as const;`;
    expect(readsOnly(abiOf(src), "total")).toBe(true);
    expect(readsOnly(abiOf(src), "owner")).toBe(true);
    expect(readsOnly(abiOf(src), "deposit")).toBe(false);
    expect(readsOnly(abiOf(src), "swap")).toBeUndefined();
  });

  it("says nothing of an ABI it cannot see", () => {
    expect(readsOnly(abiOf("declare const abi: string[]; const probe = abi;"), "balanceOf")).toBeUndefined();
    expect(readsOnly(abiOf('const probe = loadAbi("erc20");'), "balanceOf")).toBeUndefined();
  });
});
