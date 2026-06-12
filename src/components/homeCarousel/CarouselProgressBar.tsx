import React, { useCallback } from 'react';

type ProgressDotProps = {
    index: number
    isActive: boolean
    durationMs: number
    onSelect: (index: number) => void
};

function ProgressDot({ index, isActive, durationMs, onSelect }: Readonly<ProgressDotProps>) {
    const handleClick = useCallback(() => onSelect(index), [onSelect, index]);

    return (
        <button
            type='button'
            className='homeCarouselProgressBarItem'
            aria-label={`Slide ${index + 1}`}
            aria-current={isActive}
            onClick={handleClick}
        >
            <span
                className={isActive ? 'homeCarouselProgressBarFill homeCarouselProgressBarFill--active' : 'homeCarouselProgressBarFill'}
                style={isActive ? { animationDuration: `${durationMs}ms` } : undefined}
            />
        </button>
    );
}

type CarouselProgressBarProps = {
    count: number
    activeIndex: number
    durationMs: number
    onSelect: (index: number) => void
};

export default function CarouselProgressBar({
    count,
    activeIndex,
    durationMs,
    onSelect
}: Readonly<CarouselProgressBarProps>) {
    if (count <= 0) return null;

    return (
        <div className='homeCarouselProgressBar'>
            {Array.from({ length: count }, (_, i) => (
                <ProgressDot
                    key={i}
                    index={i}
                    isActive={i === activeIndex}
                    durationMs={durationMs}
                    onSelect={onSelect}
                />
            ))}
        </div>
    );
}
