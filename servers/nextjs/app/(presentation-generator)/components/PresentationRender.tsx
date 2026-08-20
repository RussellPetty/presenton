import React, { useEffect, useMemo, useRef, useState } from 'react'

import { V1ContentRender } from '../../(presentation-generator)/components/V1ContentRender';
import {
    BASE_SLIDE_HEIGHT,
    BASE_SLIDE_WIDTH,
    getSlideDimensions,
    type PresentationAspectRatio,
} from '../presentation/utils/slideAspectRatio';

const SlideScale = ({
    slide,
    theme,
    isEditMode = true,
    showEditScan = false,
    /** Fill viewport; scale may exceed 1 so slides appear larger in present mode */
    presentMode = false,
    isClickable = true,
    fixedSize = false,
    aspectRatio = "16:9",
}: {
    slide: any;
    theme?: any;
    isEditMode?: boolean;
    showEditScan?: boolean;
    presentMode?: boolean;
    isClickable?: boolean;
    fixedSize?: boolean;
    aspectRatio?: PresentationAspectRatio;
}) => {

    const containerRef = useRef<HTMLDivElement | null>(null);
    const [box, setBox] = useState({ w: 0, h: 0 });
    const dimensions = useMemo(
        () => getSlideDimensions(aspectRatio),
        [aspectRatio]
    );

    const scale = useMemo(() => {
        if (fixedSize) return 1;
        if (presentMode) {
            const { w, h } = box;
            if (w < 1 || h < 1) return 1;
            const sx = (w / dimensions.width) * 0.995;
            const sy = (h / dimensions.height) * 0.995;
            return Math.min(sx, sy);
        }
        const safeWidth = Math.max(0, box.w + 20);
        if (!safeWidth) return 1;
        return Math.min((safeWidth / dimensions.width) * 0.98, 1);
    }, [fixedSize, presentMode, box.w, box.h, dimensions]);

    useEffect(() => {
        if (!containerRef.current) return;

        const el = containerRef.current;
        const ro = new ResizeObserver(() => {
            setBox({ w: el.clientWidth, h: el.clientHeight });
        });

        ro.observe(el);
        setBox({ w: el.clientWidth, h: el.clientHeight });

        return () => ro.disconnect();
    }, []);
    return (<div
        ref={containerRef}
        className={
            fixedSize
                ? "relative overflow-hidden shadow-none"
                : `relative w-full ${presentMode ? "flex h-full min-h-0 items-center justify-center shadow-none" : "shadow-md"}`
        }
    >
        <div
            className={presentMode || fixedSize ? "relative mx-auto shrink-0" : "relative mx-auto max-w-[1280px]"}
            style={{
                width: `${dimensions.width * scale}px`,
                height: `${dimensions.height * scale}px`,
                overflow: "hidden",
                backgroundColor: "var(--background-color, #ffffff)",
            }}
        >
            <div
                className="absolute top-0 left-0"
                style={{
                    width: dimensions.width,
                    height: dimensions.height,
                    transformOrigin: "top left",
                    transform: `scale(${scale})`,
                }}
            >

                <div
                    className="slide-edit-stage absolute left-0 select-none"
                    data-testid="slide-content"
                    style={{
                        top: dimensions.contentOffsetY,
                        width: BASE_SLIDE_WIDTH,
                        height: BASE_SLIDE_HEIGHT,
                        userSelect: "none",
                        WebkitUserSelect: "none",
                        MozUserSelect: "none",
                        msUserSelect: "none",
                    } as React.CSSProperties}
                >

                    {!isClickable && <div
                        className="absolute inset-0 bg-transparent z-30 w-full h-full  select-none"
                        aria-hidden="true"

                    />}
                    <V1ContentRender slide={slide} isEditMode={isEditMode} theme={theme} />
                    {showEditScan && (
                        <div
                            className="slide-edit-overlay pointer-events-none absolute inset-0 overflow-hidden"
                            aria-hidden="true"
                        />
                    )}
                </div>


            </div>
        </div>
    </div>
    )
}

export default SlideScale
