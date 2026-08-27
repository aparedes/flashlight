import { RenderResult } from "@testing-library/react";
import { expect } from "bun:test";

export const getText = (node: HTMLElement | ChildNode): string | null => {
  if (node.childNodes.length > 0) {
    return (
      Array.from(node.childNodes)
        .map((child) => getText(child))
        .filter(Boolean)
        .join("\n") || null
    );
  }

  return node.textContent;
};

export const matchSnapshot = (wrapper: RenderResult, name: string) => {
  expect(getText(wrapper.baseElement)).toMatchSnapshot(`${name} - 1. TEXT`);
  expect(wrapper.baseElement.innerHTML).toMatchSnapshot(`${name} - 2. FULL`);
};
