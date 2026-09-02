import { describe, it, expect } from "bun:test";
import { getAnnotations } from "../src/components/Charts/getAnnotations";
import { AnnotationInterval } from "../src/components/Charts/types";

const intervals: AnnotationInterval[] = [{ y: 57, y2: 60, color: "#158000", label: "Safe Zone" }];

describe("getAnnotations", () => {
  it("returns nothing without an interval list", () => {
    expect(getAnnotations(true, undefined)).toBeUndefined();
    expect(getAnnotations(false, undefined)).toBeUndefined();
  });

  it("keeps the y-axis bands when there is no video", () => {
    const annotations = getAnnotations(false, intervals);

    expect(annotations).toBeDefined();
    expect(annotations).not.toHaveProperty("xaxis");
    expect(annotations?.yaxis).toHaveLength(1);
    expect(annotations?.yaxis?.[0]).toMatchObject({
      y: 57,
      y2: 60,
      fillColor: "#158000",
      label: { text: "Safe Zone" },
    });
  });

  it("adds the video cursor on the x-axis when a video is shown", () => {
    const annotations = getAnnotations(true, intervals);

    expect(annotations?.yaxis).toHaveLength(1);
    expect(annotations?.xaxis).toHaveLength(1);
    expect(annotations?.xaxis?.[0]).toMatchObject({ x: 0, label: { text: "Video" } });
  });

  it("returns nothing when there is neither a band nor a video", () => {
    expect(getAnnotations(false, [])).toBeUndefined();
  });
});
