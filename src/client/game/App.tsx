import { useCallback, useEffect, useRef, useState } from 'react';

type HitRating = 'ok' | 'good' | 'great' | 'perfect';

type Position = {
  x: number;
  y: number;
};

type Circle = {
  id: string;
  size: number;
  startTime: number;
  duration: number;
  hitStatus: 'correct' | 'incorrect' | 'miss' | null;
  hitTime: number | null;
  hitRating: HitRating | null; // Rating for the hit
  hitWindowStart: number; // When the hit window opens
  hitWindowEnd: number; // When the hit window closes
  perfectTime: number; // The perfect timing (when circle reaches full size)
  cellIndex: number; // Which cell this circle belongs to
  spawnPosition: Position; // Where the circle spawns (top center)
  targetPosition: Position; // Where the circle should end up (cell center)
  currentPosition: Position; // Current position during animation
};

type GridCell = {
  index: number;
  circles: Circle[];
};

type TrackItem = {
  cellIndex: number; // Which cell to spawn in (0-8, excluding 4)
  spawnTime: number; // When to spawn relative to track start (in milliseconds)
};

type Track = TrackItem[];

const GRID_SIZE = 3;
const CENTER_INDEX = 4;
const GROWTH_DURATION = 1000; 
const HIT_WINDOW_START = 150; // window before full size (in ms)
const HIT_WINDOW_DURATION = 200; // window after full size (in ms)
const HIT_FEEDBACK_DURATION = 100; // time to show feedback before disappearing

// Timing windows for ratings (relative to perfect timing at full size)
const PERFECT_WINDOW = 25; // ±25ms for Perfect
const GREAT_WINDOW = 50; // ±50ms for Great
const GOOD_WINDOW = 100; // ±100ms for Good
// OK is the rest of the valid window

// Calculate hit rating based on timing difference from perfect
const calculateHitRating = (hitTime: number, perfectTime: number): HitRating => {
  const timeDiff = Math.abs(hitTime - perfectTime);
  
  if (timeDiff <= PERFECT_WINDOW) {
    return 'perfect';
  } else if (timeDiff <= GREAT_WINDOW) {
    return 'great';
  } else if (timeDiff <= GOOD_WINDOW) {
    return 'good';
  } else {
    return 'ok';
  }
};

// Generate a test track that hits every cell multiple times
const generateSampleTrack = (): Track => {
  const track: Track = [];
  const bpm = 100; // Beats per minute (slower for testing)
  const beatDuration = (60 / bpm) * 1000; // Duration of one beat in ms
  
  // All valid cells in order: corners first, then directions
  // 0: top-left, 1: top, 2: top-right, 3: left, 5: right, 6: bottom-left, 7: bottom, 8: bottom-right
  const allCells = [0, 1, 2, 3, 5, 6, 7, 8];
  
  // Test each cell 3 times in sequence
  let currentTime = 0;
  const timeBetweenHits = beatDuration * 1.5; // 1.5 beats between each hit
  
  // Round 1: Test each cell once in order
  for (const cellIndex of allCells) {
    track.push({
      cellIndex,
      spawnTime: currentTime,
    });
    currentTime += timeBetweenHits;
  }
  
  // Round 2: Test each cell again in reverse order
  for (let i = allCells.length - 1; i >= 0; i--) {
    const cellIndex = allCells[i];
    if (cellIndex !== undefined) {
      track.push({
        cellIndex,
        spawnTime: currentTime,
      });
      currentTime += timeBetweenHits;
    }
  }
  
  // Round 3: Test each cell again in original order
  for (const cellIndex of allCells) {
    track.push({
      cellIndex,
      spawnTime: currentTime,
    });
    currentTime += timeBetweenHits;
  }
  
  // Round 4: Test corners specifically (0, 2, 6, 8)
  const corners = [0, 2, 6, 8];
  for (const cellIndex of corners) {
    track.push({
      cellIndex,
      spawnTime: currentTime,
    });
    currentTime += timeBetweenHits;
  }
  
  // Round 5: Test directions specifically (1, 3, 5, 7)
  const directions = [1, 3, 5, 7];
  for (const cellIndex of directions) {
    track.push({
      cellIndex,
      spawnTime: currentTime,
    });
    currentTime += timeBetweenHits;
  }
  
  // Round 6: Rapid fire test - all cells in quick succession
  for (const cellIndex of allCells) {
    track.push({
      cellIndex,
      spawnTime: currentTime,
    });
    currentTime += beatDuration * 0.8; // Faster for rapid fire
  }
  
  // Round 7: Final comprehensive test - mix of corners and directions
  const finalPattern = [0, 1, 2, 3, 5, 6, 7, 8, 0, 2, 6, 8, 1, 3, 5, 7];
  for (const cellIndex of finalPattern) {
    track.push({
      cellIndex,
      spawnTime: currentTime,
    });
    currentTime += timeBetweenHits;
  }
  
  // Sort by spawn time (should already be sorted, but just in case)
  return track.sort((a, b) => a.spawnTime - b.spawnTime);
};

// Map arrow keys to grid positions
const ARROW_KEY_MAP: Record<string, number> = {
  ArrowUp: 1,
  ArrowDown: 7,
  ArrowLeft: 3,
  ArrowRight: 5,
};

// Map key combinations to corner positions
const getCellIndexFromKeys = (pressedKeys: Set<string>): number | null => {
  const hasUp = pressedKeys.has('ArrowUp');
  const hasDown = pressedKeys.has('ArrowDown');
  const hasLeft = pressedKeys.has('ArrowLeft');
  const hasRight = pressedKeys.has('ArrowRight');

  // Check for corner combinations first
  if (hasUp && hasLeft) return 0; // Top-left
  if (hasUp && hasRight) return 2; // Top-right
  if (hasDown && hasLeft) return 6; // Bottom-left
  if (hasDown && hasRight) return 8; // Bottom-right

  // Single direction keys
  if (hasUp) return 1; // Top
  if (hasDown) return 7; // Bottom
  if (hasLeft) return 3; // Left
  if (hasRight) return 5; // Right

  return null;
};

export const App = () => {
  const [cells, setCells] = useState<GridCell[]>(() =>
    Array.from({ length: GRID_SIZE * GRID_SIZE }, (_, i) => ({
      index: i,
      circles: [],
    }))
  );
  const [isPlaying, setIsPlaying] = useState(false);
  const [track] = useState<Track>(() => generateSampleTrack());
  const animationFrameRef = useRef<number | undefined>(undefined);
  const trackStartTimeRef = useRef<number | null>(null);
  const spawnedIndicesRef = useRef<Set<number>>(new Set());
  const lastTriggeredKeysRef = useRef<Set<string>>(new Set());
  const cellRefs = useRef<Map<number, { element: HTMLDivElement | null; position: Position | null }>>(new Map());

  // Start track playback
  const startTrack = useCallback(() => {
    setIsPlaying(true);
    trackStartTimeRef.current = Date.now();
    spawnedIndicesRef.current.clear();
    setCells(() =>
      Array.from({ length: GRID_SIZE * GRID_SIZE }, (_, i) => ({
        index: i,
        circles: [],
      }))
    );
  }, []);

  // Spawn circles from track
  useEffect(() => {
    const spawnFromTrack = () => {
      if (!isPlaying || trackStartTimeRef.current === null) return;

      const now = Date.now();
      const elapsed = now - trackStartTimeRef.current;

      // Check each track item to see if it should spawn
      track.forEach((item, index) => {
        // Skip if already spawned
        if (spawnedIndicesRef.current.has(index)) return;

        // Spawn if it's time (with a small buffer for frame timing)
        if (elapsed >= item.spawnTime - 10) {
          spawnedIndicesRef.current.add(index);

          // Validate cell index
          if (item.cellIndex === CENTER_INDEX || item.cellIndex < 0 || item.cellIndex >= GRID_SIZE * GRID_SIZE) {
            return;
          }

          const circleId = `${item.cellIndex}-${item.spawnTime}-${index}`;

          // Calculate spawn position (top center of screen - highest point)
          const spawnPosition: Position = {
            x: window.innerWidth / 2,
            y: 0, // Top of the screen
          };

          // Get target cell position
          const cellData = cellRefs.current.get(item.cellIndex);
          const targetPosition: Position = cellData?.position || {
            x: window.innerWidth / 2,
            y: window.innerHeight / 2,
          };

          setCells((prev) =>
            prev.map((cell) =>
              cell.index === item.cellIndex
                ? {
                    ...cell,
                    circles: [
                      ...cell.circles,
                      {
                        id: circleId,
                        size: 0,
                        startTime: now,
                        duration: GROWTH_DURATION,
                        hitStatus: null,
                        hitTime: null,
                        hitRating: null,
                        hitWindowStart: now + GROWTH_DURATION - HIT_WINDOW_START,
                        hitWindowEnd: now + GROWTH_DURATION + HIT_WINDOW_DURATION,
                        perfectTime: now + GROWTH_DURATION,
                        cellIndex: item.cellIndex,
                        spawnPosition,
                        targetPosition,
                        currentPosition: spawnPosition, // Start at spawn position
                      },
                    ],
                  }
                : cell
            )
          );
        }
      });
    };

    const animate = () => {
      spawnFromTrack();

      // Update circle sizes and check for missed hits
      const now = Date.now();
      setCells((prev) =>
        prev.map((cell) => ({
          ...cell,
          circles: cell.circles
            .map((circle) => {
              // If circle has been hit, don't update size or position, just preserve it
              if (circle.hitStatus !== null) {
                // Ensure hit circles stay at target position
                return {
                  ...circle,
                  currentPosition: circle.targetPosition,
                };
              }
              
              // Check if the hit window has passed without being hit
              // Add a small buffer to avoid marking as miss immediately after window closes
              // This prevents conflicts when user is trying to hit overlapping circles
              const missBuffer = 50; // 50ms buffer
              if (now > circle.hitWindowEnd + missBuffer) {
                return {
                  ...circle,
                  hitStatus: 'miss' as const,
                  hitTime: now,
                };
              }
              
              // Otherwise, update the size as it grows and interpolate position
              const elapsed = now - circle.startTime;
              const progress = Math.min(elapsed / circle.duration, 1);
              
              // Interpolate position from spawn to target based on growth progress
              const currentPosition: Position = {
                x: circle.spawnPosition.x + (circle.targetPosition.x - circle.spawnPosition.x) * progress,
                y: circle.spawnPosition.y + (circle.targetPosition.y - circle.spawnPosition.y) * progress,
              };
              
              return {
                ...circle,
                size: progress,
                currentPosition,
              };
            })
            .filter((circle) => {
              // Remove circles that have been hit/missed and the feedback duration has passed
              if (circle.hitTime !== null) {
                const timeSinceHit = now - circle.hitTime;
                return timeSinceHit < HIT_FEEDBACK_DURATION;
              }
              // Remove circles that have grown past full size (with a small buffer)
              return circle.size <= 1.1;
            }),
        }))
      );

      animationFrameRef.current = requestAnimationFrame(animate);
    };

    animationFrameRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [isPlaying, track]);

  const handleCellPress = useCallback((cellIndex: number) => {
    const now = Date.now();
    setCells((prev) =>
      prev.map((cell) => {
        if (cell.index !== cellIndex) return cell;

        // Find circles that haven't been hit yet and are still valid (not past their window end)
        const unhitCircles = cell.circles.filter((circle) => {
          if (circle.hitStatus !== null) return false;
          // Only consider circles that are still within or before their hit window
          // Don't process circles that have already passed their window (let animation loop handle misses)
          return now <= circle.hitWindowEnd;
        });
        
        if (unhitCircles.length === 0) return cell;

        // Calculate current size for each circle based on elapsed time
        const circlesWithCurrentSize = unhitCircles.map((circle) => {
          const elapsed = now - circle.startTime;
          const currentSize = Math.min(elapsed / circle.duration, 1);
          return { ...circle, currentSize };
        });

        // Check if any circle is within the hit window (between window start and window end)
        const circlesInWindow = circlesWithCurrentSize.filter(
          (circle) => {
            return now >= circle.hitWindowStart && now <= circle.hitWindowEnd;
          }
        );

        if (circlesInWindow.length > 0) {
          // Hit correctly - prioritize the circle closest to full size (biggest circle)
          // Sort by size descending to get the biggest circle first
          const sortedCircles = [...circlesInWindow].sort((a, b) => b.currentSize - a.currentSize);
          const hitCircle = sortedCircles[0];
          if (hitCircle) {
            const rating = calculateHitRating(now, hitCircle.perfectTime);
            // Only update the hit circle, leave all other circles completely untouched
            return {
              ...cell,
              circles: cell.circles.map((circle) =>
                circle.id === hitCircle.id
                  ? { 
                      ...circle, 
                      hitStatus: 'correct' as const, 
                      hitTime: now, 
                      hitRating: rating,
                      size: hitCircle.currentSize,
                      currentPosition: hitCircle.targetPosition // Snap to target position when hit
                    }
                  : circle // Return other circles unchanged
              ),
            };
          }
        }
        // If no circle is in the window, don't mark anything - just return cell unchanged
        // This ensures that when you press to hit a bigger circle, smaller circles are not affected
        return cell;
      })
    );
  }, []);

  // Handle keyboard input (arrow keys for desktop)
  useEffect(() => {
    const pressedKeys = new Set<string>();

    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle arrow keys
      if (!ARROW_KEY_MAP.hasOwnProperty(e.key)) return;
      
      e.preventDefault();
      pressedKeys.add(e.key);

      // Get the cell index based on currently pressed keys
      const targetIndex = getCellIndexFromKeys(pressedKeys);
      
      if (targetIndex !== null) {
        // Create a signature for the current key combination
        const currentKeys = Array.from(pressedKeys).sort().join(',');
        const lastKeys = Array.from(lastTriggeredKeysRef.current).sort().join(',');
        
        // Only trigger if this is a new combination (to avoid spamming)
        if (currentKeys !== lastKeys) {
          lastTriggeredKeysRef.current = new Set(pressedKeys);
          handleCellPress(targetIndex);
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (!ARROW_KEY_MAP.hasOwnProperty(e.key)) return;
      
      e.preventDefault();
      pressedKeys.delete(e.key);
      
      // Reset the last triggered keys when a key is released
      // This allows the same combination to be triggered again if pressed again
      if (pressedKeys.size === 0) {
        lastTriggeredKeysRef.current.clear();
      } else {
        // Update last triggered to current state when keys change
        const currentKeys = Array.from(pressedKeys).sort().join(',');
        const lastKeys = Array.from(lastTriggeredKeysRef.current).sort().join(',');
        if (currentKeys !== lastKeys) {
          lastTriggeredKeysRef.current = new Set(pressedKeys);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [handleCellPress]);

  // Check if track is finished
  useEffect(() => {
    if (!isPlaying || trackStartTimeRef.current === null) return;

    const checkTrackFinished = () => {
      const now = Date.now();
      const elapsed = now - trackStartTimeRef.current!;
      
      if (track.length === 0) {
        setIsPlaying(false);
        trackStartTimeRef.current = null;
        spawnedIndicesRef.current.clear();
        return;
      }
      
      const lastSpawnTime = Math.max(...track.map((item) => item.spawnTime));
      const trackEndTime = lastSpawnTime + GROWTH_DURATION + HIT_WINDOW_DURATION + HIT_FEEDBACK_DURATION;

      if (elapsed > trackEndTime) {
        setIsPlaying(false);
        trackStartTimeRef.current = null;
        spawnedIndicesRef.current.clear();
      }
    };

    const interval = setInterval(checkTrackFinished, 100);
    return () => clearInterval(interval);
  }, [isPlaying, track]);

  return (
    <div className="flex flex-col justify-center items-center min-h-screen gap-4 p-4">
      {!isPlaying && (
        <>
          <h1 className="text-2xl font-bold text-gray-900 mb-4">Rhythm Game</h1>
          <button
            onClick={startTrack}
            className="px-6 py-2 bg-[#d93900] text-white rounded-lg font-semibold hover:bg-[#b83100] transition-colors"
          >
            Start Track
          </button>
        </>
      )}
      <div
        className="grid gap-2"
        style={{
          gridTemplateColumns: `repeat(${GRID_SIZE}, 1fr)`,
          width: 'min(90vw, 400px)',
          aspectRatio: '1',
        }}
      >
        {cells.map((cell) => {
          const isCenter = cell.index === CENTER_INDEX;
          return (
            <div
              key={cell.index}
              ref={(el) => {
                if (el) {
                  const rect = el.getBoundingClientRect();
                  const centerX = rect.left + rect.width / 2;
                  const centerY = rect.top + rect.height / 2;
                  cellRefs.current.set(cell.index, {
                    element: el,
                    position: { x: centerX, y: centerY },
                  });
                } else {
                  cellRefs.current.delete(cell.index);
                }
              }}
              className={`
                relative border-2 rounded-lg flex items-center justify-center
                ${isCenter ? 'bg-gray-200 border-gray-300' : 'bg-white border-gray-400 cursor-pointer'}
                ${!isCenter ? 'hover:border-[#d93900] active:bg-gray-50' : ''}
              `}
              onClick={() => !isCenter && handleCellPress(cell.index)}
              onTouchStart={(e) => {
                if (!isCenter) {
                  e.preventDefault();
                  handleCellPress(cell.index);
                }
              }}
            >
              {!isCenter &&
                cell.circles.map((circle) => {
                  // Determine circle color based on hit status and rating
                  let bgColor: string;
                  if (circle.hitStatus === 'correct' && circle.hitRating) {
                    // Different colors for different ratings
                    switch (circle.hitRating) {
                      case 'perfect':
                        bgColor = '#fbbf24'; // yellow-400 - gold for perfect
                        break;
                      case 'great':
                        bgColor = '#22c55e'; // green-500 - bright green for great
                        break;
                      case 'good':
                        bgColor = '#3b82f6'; // blue-500 - blue for good
                        break;
                      case 'ok':
                        bgColor = '#10b981'; // emerald-500 - darker green for ok
                        break;
                      default:
                        bgColor = '#22c55e'; // fallback to green
                    }
                  } else if (circle.hitStatus === 'incorrect' || circle.hitStatus === 'miss') {
                    bgColor = '#ef4444'; // red-500
                  } else {
                    bgColor = '#d93900'; // Default orange/red
                  }
                  
                  // Calculate circle radius in pixels (base size on target cell size)
                  const cellData = cellRefs.current.get(circle.cellIndex);
                  const baseRadius = cellData?.element 
                    ? Math.min(cellData.element.getBoundingClientRect().width, cellData.element.getBoundingClientRect().height) / 2
                    : 50;
                  const radius = baseRadius * circle.size;
                  
                  return (
                    <div
                      key={circle.id}
                      className="fixed pointer-events-none"
                      style={{
                        left: `${circle.currentPosition.x}px`,
                        top: `${circle.currentPosition.y}px`,
                        transform: 'translate(-50%, -50%)',
                        zIndex: 20,
                      }}
                    >
                      <div
                        className="rounded-full"
                        style={{
                          width: `${radius * 2}px`,
                          height: `${radius * 2}px`,
                          backgroundColor: bgColor,
                          opacity: circle.hitStatus ? 1 : 0.8,
                          transition: circle.hitStatus ? 'background-color 0.1s ease-out, opacity 0.1s ease-out' : 'none',
                        }}
                      />
                      {circle.hitStatus === 'correct' && circle.hitRating && (
                        <div
                          className="absolute inset-0 flex items-center justify-center font-bold text-white text-shadow-lg pointer-events-none"
                          style={{
                            textShadow: '2px 2px 4px rgba(0,0,0,0.5)',
                            fontSize: 'clamp(0.75rem, 2vw, 1.25rem)',
                            textTransform: 'uppercase',
                            letterSpacing: '0.05em',
                          }}
                        >
                          {circle.hitRating}
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          );
        })}
      </div>
      <div className="text-sm text-gray-600 mt-4 text-center">
        <p>Tap cells or use arrow keys when circles reach full size</p>
      </div>
    </div>
  );
};
