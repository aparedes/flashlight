import React, {
  FunctionComponent,
  PropsWithChildren,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { ArrowDownIcon } from "./icons/ArrowDownIcon";

type Props = PropsWithChildren<{
  header: React.ReactNode;
  className?: string;
  unmountOnExit?: boolean;
}>;

type COLLAPSE_STATE = "EXPANDING" | "COLLAPSING" | "COLLAPSED" | "EXPANDED";

const TRANSITION_DURATION = 300;

const useCollapsible = (unmountOnExit: boolean) => {
  const [collapseState, setCollapseState] = useState<COLLAPSE_STATE>("COLLAPSED");

  const toggleIsExpanded = useCallback(() => {
    if (collapseState === "COLLAPSED") {
      setCollapseState("EXPANDING");
    } else if (collapseState === "EXPANDED") {
      setCollapseState("COLLAPSING");
    }
  }, [collapseState]);

  useEffect(() => {
    // This runs in the browser: `NodeJS.Timeout` would be the wrong type here.
    let timeout: ReturnType<typeof setTimeout> | undefined;

    if (collapseState === "EXPANDING") {
      setCollapseState("EXPANDED");
    } else if (collapseState === "COLLAPSING") {
      timeout = setTimeout(() => setCollapseState("COLLAPSED"), TRANSITION_DURATION);
    }

    return () => {
      clearTimeout(timeout);
    };
  }, [collapseState]);

  return {
    isExpanded: collapseState === "EXPANDED",
    showChildren: unmountOnExit
      ? ["EXPANDING", "EXPANDED", "COLLAPSING"].includes(collapseState)
      : true,
    toggleIsExpanded,
  };
};

export const Collapsible: FunctionComponent<Props> = ({
  header,
  className,
  children,
  unmountOnExit = false,
}) => {
  const childrenContainerRef = useRef<HTMLDivElement>(null);

  const { isExpanded, showChildren, toggleIsExpanded } = useCollapsible(unmountOnExit);

  // The height to animate to is measured from the DOM once the children are committed — reading
  // `scrollHeight` during render is a ref access the React Compiler refuses to optimise around.
  // A layout effect keeps the measurement in the same frame, so the transition still starts
  // from 0 and the page never paints an unmeasured expanded state.
  const [contentHeight, setContentHeight] = useState(0);
  useLayoutEffect(() => {
    setContentHeight(isExpanded ? (childrenContainerRef.current?.scrollHeight ?? 0) : 0);
  }, [isExpanded, children]);

  return (
    <div className={`${className} cursor-pointer`} onClick={toggleIsExpanded}>
      <div className="flex flex-row w-full items-center">
        <div className="flex-1">{header}</div>
        <ArrowDownIcon
          className={`${isExpanded ? "rotate-180" : "rotate-0"} transition-transform ease-linear`}
        />
      </div>

      <div
        ref={childrenContainerRef}
        className={`cursor-default overflow-hidden transition-[height] duration-300`}
        style={{ height: contentHeight }}
        onClick={(event) => event.stopPropagation()}
      >
        {showChildren ? children : null}
      </div>
    </div>
  );
};
