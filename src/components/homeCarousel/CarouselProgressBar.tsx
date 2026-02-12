import React, { type FC, useCallback, useMemo } from 'react';

interface ProgressBarItemProps {
    index: number;
    isActive: boolean;
    isPassed: boolean;
    isPaused: boolean;
    animDuration: string;
    onAnimationEnd: () => void;
    onClick: (index: number) => void;
}

const ProgressBarItem: FC<ProgressBarItemProps> = ({
    index,
    isActive,
    isPassed,
    isPaused,
    animDuration,
    onAnimationEnd,
    onClick
}) => {
    const barClassName = useMemo(() => {
        const classes = ['carouselProgressBar-bar'];

        if (isActive) {
            classes.push('carouselProgressBar-bar--active');
            if (isPaused) {
                classes.push('carouselProgressBar-bar--paused');
            }
        } else if (isPassed) {
            classes.push('carouselProgressBar-bar--passed');
        }

        return classes.join(' ');
    }, [isActive, isPassed, isPaused]);

    const handleClick = useCallback(() => {
        onClick(index);
    }, [onClick, index]);

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onClick(index);
        }
    }, [onClick, index]);

    return (
        <div
            role='button'
            tabIndex={0}
            className='carouselProgressBar-item'
            onClick={handleClick}
            onKeyDown={handleKeyDown}
        >
            <div
                className={barClassName}
                style={{ animationDuration: animDuration }}
                onAnimationEnd={isActive ? onAnimationEnd : undefined}
            />
        </div>
    );
};

interface CarouselProgressBarProps {
    pages: number;
    currentIndex: number;
    duration: number;
    paused: boolean;
    onAnimationEnd: () => void;
    onProgressClicked: (index: number) => void;
}

const CarouselProgressBar: FC<CarouselProgressBarProps> = ({
    pages,
    currentIndex,
    duration,
    paused,
    onAnimationEnd,
    onProgressClicked
}) => {
    const animDuration = useMemo(() => `${duration / 1000}s`, [duration]);

    return (
        <div className='carouselProgressBar'>
            {Array.from({ length: pages }).map((_, i) => (
                <ProgressBarItem
                    // eslint-disable-next-line react/no-array-index-key
                    key={`progress-${i}`}
                    index={i}
                    isActive={i === currentIndex}
                    isPassed={i < currentIndex}
                    isPaused={paused}
                    animDuration={animDuration}
                    onAnimationEnd={onAnimationEnd}
                    onClick={onProgressClicked}
                />
            ))}
        </div>
    );
};

export default CarouselProgressBar;
