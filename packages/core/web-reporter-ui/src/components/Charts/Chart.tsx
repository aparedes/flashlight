import React, { useMemo } from "react";
import ReactApexChart, { Props as ApexChartProps } from "react-apexcharts";
// apexcharts 7 no longer declares its option types as ambient globals — they are exported
// from the package (merged into the `ApexCharts` class namespace) and must be imported.
import { type ApexAxisChartSeries, type ApexOptions } from "apexcharts";
import { POLLING_INTERVAL } from "@lantern/types";
import { merge } from "es-toolkit";

export const Chart = ({
  type,
  title,
  series,
  options = {},
  height,
  colors,
}: {
  type: Exclude<ApexChartProps["type"], undefined>;
  title: string | React.ReactNode;
  series: ApexAxisChartSeries;
  options?: ApexOptions;
  height: number;
  colors?: string[];
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

  // `merge` mutates and returns its first argument, so it has to start from a fresh object:
  // merging straight into `commonOptions` would hand react-apexcharts the very same reference
  // on every render, and it would never notice an option change.
  // es-toolkit's merge generic also mangles the deep option types (apexcharts 7's animation
  // typings in particular); the runtime shape is still ApexOptions.
  const chartOptions = useMemo(
    () => merge(merge({}, commonOptions), options) as ApexOptions,
    [commonOptions, options]
  );

  return (
    <>
      <div className="mb-[5px] ml-[10px] text-2xl text-white flex flex-row font-medium">
        {title}
      </div>
      <ReactApexChart options={chartOptions} series={series} type={type} height={height} />
    </>
  );
};
