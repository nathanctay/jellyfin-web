import * as THREE from './vendor/three.module.min.js';

export const createRoundedPlane = (width, height, radius) => {
                const shape = new THREE.Shape();
                shape.moveTo(-width/2, -height/2 + radius);
                shape.lineTo(-width/2, height/2 - radius);
                shape.quadraticCurveTo(-width/2, height/2, -width/2 + radius, height/2);
                shape.lineTo(width/2 - radius, height/2);
                shape.quadraticCurveTo(width/2, height/2, width/2, height/2 - radius);
                shape.lineTo(width/2, -height/2 + radius);
                shape.quadraticCurveTo(width/2, -height/2, width/2 - radius, -height/2);
                shape.lineTo(-width/2 + radius, -height/2);
                shape.quadraticCurveTo(-width/2, -height/2, -width/2, -height/2 + radius);
                
                const geo = new THREE.ShapeGeometry(shape);
                const pos = geo.attributes.position;
                const uvs = geo.attributes.uv;
                for (let i = 0; i < pos.count; i++) {
                    const u = (pos.getX(i) + width/2) / width;
                    const v = (pos.getY(i) + height/2) / height;
                    uvs.setXY(i, u, v);
                }
                return geo;
            };
