import { describe, it, expect, jest } from "bun:test";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { AppPicker } from "../../webapp/components/AppPicker";

const PLACEHOLDER = "Bundle id — type or pick an installed app";

const Picker = ({ value, onChange }: { value: string; onChange: (bundleId: string) => void }) => (
  <AppPicker apps={[]} platform="android" value={value} onChange={onChange} onOpen={() => {}} />
);

const type = (text: string) => {
  fireEvent.change(screen.getByPlaceholderText(PLACEHOLDER), { target: { value: text } });
};

const expectEmitted = (onChange: ReturnType<typeof jest.fn>, bundleId: string) =>
  waitFor(() => expect(onChange).toHaveBeenLastCalledWith(bundleId));

describe("<AppPicker />", () => {
  it("emits the typed bundle id debounced", async () => {
    const onChange = jest.fn();
    render(<Picker value="" onChange={onChange} />);

    type("c");
    type("co");
    type("com");
    expect(onChange).not.toHaveBeenCalled();

    await expectEmitted(onChange, "com");
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("keeps the typed text when the CLI echoes an earlier emit late", async () => {
    const onChange = jest.fn();
    const { rerender } = render(<Picker value="" onChange={onChange} />);
    const input = screen.getByPlaceholderText(PLACEHOLDER) as HTMLInputElement;

    type("a");
    await expectEmitted(onChange, "a");
    type("ab");
    await expectEmitted(onChange, "ab");
    // Still being typed, not emitted yet
    type("abc");

    // The echoes of the two emits arrive only now, one after the other
    rerender(<Picker value="a" onChange={onChange} />);
    expect(input.value).toBe("abc");
    rerender(<Picker value="ab" onChange={onChange} />);
    expect(input.value).toBe("abc");

    // ...and the pending emit was not cancelled by them
    await expectEmitted(onChange, "abc");
    rerender(<Picker value="abc" onChange={onChange} />);
    expect(input.value).toBe("abc");
    expect(onChange).toHaveBeenCalledTimes(3);
  });

  it("adopts a bundle id changed for another reason than typing", async () => {
    const onChange = jest.fn();
    const { rerender } = render(<Picker value="" onChange={onChange} />);
    const input = screen.getByPlaceholderText(PLACEHOLDER) as HTMLInputElement;

    type("a");
    await expectEmitted(onChange, "a");
    type("ab");

    // e.g. the CLI auto-detected the running app: the in-flight text is dropped for it
    rerender(<Picker value="com.detected" onChange={onChange} />);
    expect(input.value).toBe("com.detected");

    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
