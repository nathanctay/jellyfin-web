import React from 'react'

type CarouselProgressBarProps = {
    count: number
    activeIndex: number
    durationMs: number
    onSelect: (index: number) => void
}

export default function CarouselProgressBar({
    count,
    activeIndex,
    durationMs,
    onSelect
}: CarouselProgressBarProps) {
    if (count <= 0) return null

    return (
        <div className="homeCarouselProgressBar">
            {Array.from({ length: count }, (_, i) => {
                const isActive = i === activeIndex
                return (
                    <button
                        key={i}
                        type="button"
                        className="homeCarouselProgressBarItem"
                        aria-label={`Slide ${i + 1}`}
                        aria-current={isActive}
                        onClick={() => onSelect(i)}
                    >
                        <span
                            className={isActive ? 'homeCarouselProgressBarFill homeCarouselProgressBarFill--active' : 'homeCarouselProgressBarFill'}
                            style={isActive ? { animationDuration: `${durationMs}ms` } : undefined}
                        />
                    </button>
                )
            })}
        </div>
    )
}
