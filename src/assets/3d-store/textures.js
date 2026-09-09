// Polyfill for CanvasRenderingContext2D.roundRect
if (!CanvasRenderingContext2D.prototype.roundRect) {
    CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
        if (w < 2 * r) r = w / 2;
        if (h < 2 * r) r = h / 2;
        this.beginPath();
        this.moveTo(x + r, y);
        this.arcTo(x + w, y, x + w, y + h, r);
        this.arcTo(x + w, y + h, x, y + h, r);
        this.arcTo(x, y + h, x, y, r);
        this.arcTo(x, y, x + r, y, r);
        this.closePath();
        return this;
    };
}

import * as THREE from './vendor/three.module.min.js';

export function createBackCoverTexture(item, palette, STORE_DESIGN) {
                const canvas = document.createElement('canvas');
                canvas.width = 512;
                canvas.height = 768; // 1:1.5 ratio
                const ctx = canvas.getContext('2d');

                if (!palette) palette = { bg: '#1c1c1e', text: '#ffffff', subtext: '#cccccc', divider: '#333333' };

                // Base Background
                ctx.fillStyle = palette.bg;
                ctx.fillRect(0, 0, canvas.width, canvas.height);

                // Blockbuster-style Top Header Bar
                ctx.fillStyle = '#0000aa'; // Blue bar
                ctx.fillRect(0, 0, canvas.width, 40);
                ctx.fillStyle = '#ffcc00'; // Yellow text
                ctx.font = 'bold 20px "Arial Black", sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText('GUARANTEED TO BE THERE', canvas.width / 2, 28);

                // MPAA Rating Box (Top Right)
                const rating = item.OfficialRating || 'NR';
                ctx.font = 'bold 22px "Arial Black", sans-serif';
                // Measure the text and pad it nicely
                const ratingWidth = Math.max(52, ctx.measureText(rating).width + 20);
                const boxRight = canvas.width - 30; // 30px margin from right
                const boxLeft = boxRight - ratingWidth;

                ctx.fillStyle = '#ffffff';
                ctx.fillRect(boxLeft - 4, 60, ratingWidth + 8, 45);
                ctx.strokeStyle = '#000000';
                ctx.lineWidth = 3;
                ctx.strokeRect(boxLeft, 64, ratingWidth, 37);

                ctx.fillStyle = '#000000';
                ctx.textAlign = 'center';
                ctx.fillText(rating, boxLeft + ratingWidth / 2, 93);

                // Title
                ctx.fillStyle = palette.text;
                ctx.font = 'bold 44px "Helvetica Neue", sans-serif';
                ctx.textAlign = 'left';

                function wrapText(context, text, x, y, maxWidth, lineHeight, maxLines = 10) {
                    if (!text) return y;
                    const words = text.split(' ');
                    let line = '';
                    let currentY = y;
                    let lines = 0;

                    for (let n = 0; n < words.length; n++) {
                        const testLine = line + words[n] + ' ';
                        const metrics = context.measureText(testLine);
                        const testWidth = metrics.width;
                        if (testWidth > maxWidth && n > 0) {
                            context.fillText(line, x, currentY);
                            line = words[n] + ' ';
                            currentY += lineHeight;
                            lines++;
                            if (lines >= maxLines) {
                                context.fillText('...', x, currentY);
                                return currentY + lineHeight;
                            }
                        } else {
                            line = testLine;
                        }
                    }
                    context.fillText(line, x, currentY);
                    return currentY + lineHeight;
                }

                let yPos = 100; // Below header
                // Title wraps but avoids the rating box!
                yPos = wrapText(ctx, item.Name || 'Unknown Title', 30, yPos, canvas.width - 120, 50, 3);

                // Meta info
                ctx.font = '22px "Helvetica Neue", sans-serif';
                ctx.fillStyle = palette.subtext;
                const year = item.ProductionYear || '----';
                let runtime = '';
                if (item.RunTimeTicks) {
                    const mins = Math.floor(item.RunTimeTicks / 600000000);
                    const h = Math.floor(mins / 60);
                    const m = mins % 60;
                    runtime = h > 0 ? `${h}h ${m}m` : `${m}m`;
                }
                const genre = (item.Genres && item.Genres.length > 0) ? item.Genres[0] : '';
                ctx.fillText(`${year}  ·  ${runtime}  ${genre ? '·  ' + genre : ''}`, 30, yPos + 10);
                yPos += 50;

                // Divider
                ctx.strokeStyle = palette.divider;
                ctx.lineWidth = 2;
                ctx.beginPath(); ctx.moveTo(30, yPos); ctx.lineTo(canvas.width - 30, yPos); ctx.stroke();
                yPos += 40;

                // Synopsis Header
                ctx.fillStyle = '#f5c518';
                ctx.font = 'bold 16px "Helvetica Neue", sans-serif';
                ctx.fillText('S Y N O P S I S', 30, yPos);
                yPos += 40;

                // Synopsis Body
                ctx.fillStyle = palette.text;
                ctx.font = '22px "Helvetica Neue", sans-serif';
                yPos = wrapText(ctx, item.Overview || 'No synopsis available.', 30, yPos, canvas.width - 60, 32, 10);

                // --- Bottom Graphics ---
                const bottomY = canvas.height - 100;

                // 1. Procedural UPC Barcode (Bottom Left)
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(30, bottomY, 140, 70);
                ctx.fillStyle = '#000000';
                
                // Simple deterministic PRNG
                let seed = 0;
                if (item.Id) {
                    for (let i = 0; i < item.Id.length; i++) {
                        seed = Math.imul(31, seed) + item.Id.charCodeAt(i) | 0;
                    }
                }
                const random = () => {
                    let t = seed += 0x6D2B79F5;
                    t = Math.imul(t ^ t >>> 15, t | 1);
                    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
                    return ((t ^ t >>> 14) >>> 0) / 4294967296;
                };

                let currentX = 40;
                for(let i=0; i<30; i++) {
                    const barW = random() > 0.6 ? 4 : 2; // Random thin/thick bars
                    if (currentX + barW > 160) break;
                    ctx.fillRect(currentX, bottomY + 10, barW, 40);
                    currentX += barW + (random() * 3 + 1);
                }
                ctx.font = 'bold 12px monospace';
                ctx.textAlign = 'center';
                ctx.fillText('4  39120  48291  8', 100, bottomY + 65);

                // 2. VHS / Hi-Fi Stereo Tech Logos (Bottom Center)
                ctx.fillStyle = palette.subtext;
                ctx.font = 'bold 18px "Arial", sans-serif';
                ctx.textAlign = 'center';
                const formatLabel = STORE_DESIGN === 'dvd' ? 'DVD' : 'VHS';
                const audioLabel = STORE_DESIGN === 'dvd' ? 'DOLBY DIGITAL' : 'Hi-Fi STEREO';
                ctx.fillText(formatLabel, 230, bottomY + 30);
                ctx.font = '12px "Arial", sans-serif';
                ctx.fillText(audioLabel, 230, bottomY + 50);

                // 3. Rental Sticker (Bottom Right)
                ctx.fillStyle = '#111111';
                ctx.roundRect(canvas.width - 200, bottomY, 170, 70, 10);
                ctx.fill();
                ctx.strokeStyle = '#f5c518';
                ctx.lineWidth = 2;
                ctx.roundRect(canvas.width - 195, bottomY + 5, 160, 60, 6);
                ctx.stroke();

                ctx.fillStyle = '#f5c518';
                ctx.font = 'bold 14px "Helvetica Neue", sans-serif';
                ctx.fillText('RENTAL COPY', canvas.width - 115, bottomY + 38);
                ctx.fillStyle = '#aaaaaa';
                ctx.font = '12px "Helvetica Neue", sans-serif';
                ctx.fillText('Please Rewind', canvas.width - 115, bottomY + 56);

                const tex = new THREE.CanvasTexture(canvas);
                tex.colorSpace = THREE.SRGBColorSpace;
                return tex;
            }

export function createSpineTexture(item, palette, STORE_DESIGN, scaleDown = false) {
                const canvas = document.createElement('canvas');
                const scale = scaleDown ? 0.5 : 1.0;
                const w = 64; const h = 960;
                canvas.width = w * scale; 
                canvas.height = h * scale;
                const ctx = canvas.getContext('2d');
                ctx.scale(scale, scale);

                if (!palette) palette = { bg: '#1c1c1e', text: '#ffffff', subtext: '#cccccc', divider: '#333333' };

                // Background
                ctx.fillStyle = palette.bg;
                ctx.fillRect(0, 0, w, h);

                // Sticker at Top
                if (STORE_DESIGN === 'vhs') {
                    ctx.fillStyle = '#f5c518'; // Yellow
                    ctx.fillRect(0, 0, w, 100);

                    // Sticker Text (Rotated slightly or stacked)
                    ctx.fillStyle = '#111111';
                    ctx.font = 'bold 14px "Helvetica Neue", sans-serif';
                    ctx.textAlign = 'center';
                    ctx.fillText('SHELF', w / 2, 40);
                    ctx.fillText('COPY', w / 2, 60);
                }

                // Spine Title (Rotated 90 degrees)
                ctx.save();
                ctx.translate(w / 2, 160); // Start below the sticker
                ctx.rotate(Math.PI / 2); // Rotate 90 degrees clockwise

                ctx.fillStyle = palette.text;
                ctx.font = 'bold 36px "Helvetica Neue", sans-serif';
                ctx.textAlign = 'left';
                ctx.textBaseline = 'middle';

                // Truncate if too long (roughly 750px width available when rotated)
                let title = item.Name || 'Unknown Title';
                if (ctx.measureText(title).width > 750) {
                    while (ctx.measureText(title + '...').width > 750 && title.length > 0) {
                        title = title.substring(0, title.length - 1);
                    }
                    title += '...';
                }

                ctx.fillText(title, 0, 0);
                ctx.restore();

                const tex = new THREE.CanvasTexture(canvas);
                tex.colorSpace = THREE.SRGBColorSpace;
                return tex;
            }