import React, { useEffect, useMemo, useRef } from "react";
import ReactApexChart, { Props as ApexChartProps } from "react-apexcharts";
// apexcharts 7 no longer declares its option types as ambient globals — they are exported
// from the package (merged into the `ApexCharts` class namespace) and must be imported.
import ApexCharts, { type ApexAxisChartSeries, type ApexOptions } from "apexcharts";
import { POLLING_INTERVAL } from "@perf-profiler/types";
import { merge, partition } from "es-toolkit";

function toggleSeriesVisibility(
  chart: ApexCharts,
  seriesNames: string[],
  visibleSeriesNames?: string[]
) {
  const [seriesToShow, seriesToHide] = partition(seriesNames, (name) => {
    if (!visibleSeriesNames) return true;
    return visibleSeriesNames.includes(name);
  });

  seriesToHide.forEach((name) => {
    try {
      chart.hideSeries(name);
    } catch {
      // don't do anything
    }
  });
  seriesToShow.forEach((name) => {
    try {
      chart.showSeries(name);
    } catch {
      // don't do anything
    }
  });
}

export const Chart = ({
  type,
  title,
  series,
  options = {},
  height,
  colors,
  visibleSeriesNames,
}: {
  type: Exclude<ApexChartProps["type"], undefined>;
  title: string | React.ReactNode;
  series: ApexAxisChartSeries;
  options?: ApexOptions;
  height: number;
  colors?: string[];
  visibleSeriesNames?: string[];
}) => {
  const commonOptions: ApexOptions = useMemo(
    () => ({
      chart: {
        animations: {
          enabled: true,
          easing: "linear",
          dynamicAnimation: {
            speed: POLLING_INTERVAL,
          },
        },
        zoom: {
          enabled: false,
        },
        toolbar: {
          show: false,
        },
      },
      dataLabels: {
        enabled: false,
      },
      stroke: {
        curve: "smooth",
      },
      xaxis: {
        labels: {
          style: { colors: "#FFFFFF99" },
        },
      },
      yaxis: {
        labels: { style: { colors: "#FFFFFF99" } },
      },
      colors,
      legend: {
        labels: {
          colors: "#FFFFFF99",
        },
      },
      grid: {
        borderColor: "#FFFFFF33",
        strokeDashArray: 3,
      },
    }),
    [colors]
  );

  const chartOptions = useMemo(() => merge(commonOptions, options), [commonOptions, options]);

  // react-apexcharts 2 is a function component: it no longer forwards a ref to the chart
  // instance, and exposes it through the dedicated `chartRef` prop instead.
  const ref = useRef<ApexCharts | null>(null);
  const seriesRef = useRef(series);
  seriesRef.current = series;

  useEffect(() => {
    const chart = ref.current;
    if (!chart) return;

    toggleSeriesVisibility(
      chart,
      seriesRef.current.map((serie) => serie.name).filter((name): name is string => !!name),
      visibleSeriesNames
    );
  }, [visibleSeriesNames]);

  return (
    <>
      <div className="mb-[5px] ml-[10px] text-2xl text-white flex flex-row font-medium">
        {title}
      </div>
      <ReactApexChart
        chartRef={ref}
        options={chartOptions}
        series={series}
        type={type}
        height={height}
      />
    </>
  );
};
