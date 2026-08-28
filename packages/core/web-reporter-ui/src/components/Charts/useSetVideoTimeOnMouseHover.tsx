import { useRef, useMemo } from "react";
// apexcharts 7 no longer declares its option types as ambient globals — they are exported
// from the package (merged into the `ApexCharts` class namespace) and must be imported.
import type { ApexChart } from "apexcharts";
import { setVideoCurrentTime } from "../../../videoCurrentTimeContext";
import { RangeAreaSeriesType, LineSeriesType } from "./types";

export const getLastX = (series: RangeAreaSeriesType | LineSeriesType) => {
  if (series.length === 0) return undefined;
  const lastDataPoint = series[0].data.at(-1);
  return typeof lastDataPoint === "object" && lastDataPoint !== null && "x" in lastDataPoint
    ? lastDataPoint.x
    : undefined;
};

/**
 * `mouseMove` hands back the ApexCharts instance. Its public typings only declare the
 * documented methods, but the chart element and the render state we need to map a mouse
 * position onto a video timestamp live on the instance itself (`el` / `w.globals`).
 * apexcharts 7 moved the layout fields to `w.layout`, keeping back-compat accessors on
 * `w.globals` (see `Base.js`), so this read is stable across both.
 */
type ChartInternals = {
  el: HTMLElement;
  w: { globals: { gridWidth: number; translateX: number } };
};

export const useSetVideoTimeOnMouseHover = ({
  lastX,
}: {
  lastX: number | string | undefined;
}): ApexChart["events"] => {
  const lastXRef = useRef(lastX);

  // Just making sure the useMemo doesn't depend on series since it doesn't need to
  lastXRef.current = lastX;

  return useMemo(
    () => ({
      mouseMove: (event, apexChart) => {
        if (lastXRef.current === undefined) return;

        const chart = apexChart as unknown as ChartInternals | undefined;
        if (!chart) return;

        const totalWidth = chart.w.globals.gridWidth;

        const mouseX =
          event.clientX - chart.el.getBoundingClientRect().left - chart.w.globals.translateX;

        const maxX = lastXRef.current;

        if (typeof maxX === "string") return;

        setVideoCurrentTime((mouseX / totalWidth) * maxX);

        // Manually translate via DOM to avoid re-rendering the chart
        const annotations = document.getElementsByClassName("apexcharts-xaxis-annotations");

        for (const annotation of annotations) {
          annotation.setAttribute("style", `transform: translateX(${mouseX}px);`);
        }
      },
    }),
    []
  );
};
