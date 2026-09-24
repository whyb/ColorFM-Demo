
// ── HWC → CHW (uint8 [0,255] → float32 [0,1]) ──────────────────────────
// Matches C++ hwc2chw_omp<uint8_t, float>(ch, w, h, src, dst, 1.0/255.0)
function hwc2chw(src, dst, channels, width, height, alpha = 1 / 255) {
    const hwStride = width * height;
    for (let s = 0; s < hwStride; s++) {
        let srcIdx = s * channels;
        let dstIdx = s;
        for (let c = 0; c < channels; c++) {
            dst[dstIdx] = src[srcIdx++] * alpha;
            dstIdx += hwStride;
        }
    }
}

// ── CHW → HWC (float32 [0,1] → uint8 [0,255]) ──────────────────────────
// Matches C++ chw2hwc_omp<float, uint8_t>(ch, w, h, src, dst, 255.0)
function chw2hwc(src, dst, channels, width, height, alpha = 255) {
    const hwStride = width * height;
    for (let s = 0; s < hwStride; s++) {
        let dstIdx = s * channels;
        let srcIdx = s;
        for (let c = 0; c < channels; c++) {
            let val = src[srcIdx] * alpha;
            dst[dstIdx++] = Math.min(255, Math.max(0, Math.round(val)));
            srcIdx += hwStride;
        }
    }
}

// ── HWC → CHW for CodeFormer: (val - 127.5) / 127.5 → range [-1, 1] ────
// Matches C++ hwc2chw_codeformer<uint8_t, float>
function hwc2chwCodeFormer(src, dst, width, height) {
    const channels = 3;
    const hwStride = width * height;
    for (let s = 0; s < hwStride; s++) {
        let srcIdx = s * channels;
        let dstIdx = s;
        for (let c = 0; c < channels; c++) {
            dst[dstIdx] = (src[srcIdx++] - 127.5) / 127.5;
            dstIdx += hwStride;
        }
    }
}

// ── CHW → HWC for CodeFormer: (val + 1.0) * 127.5 → clamp [0, 255] ──────
// Matches C++ chw2hwc_codeformer<float, uint8_t>
function chw2hwcCodeFormer(src, dst, width, height) {
    const channels = 3;
    const hwStride = width * height;
    for (let s = 0; s < hwStride; s++) {
        let dstIdx = s * channels;
        let srcIdx = s;
        for (let c = 0; c < channels; c++) {
            let pixel = (src[srcIdx] + 1.0) * 127.5;
            dst[dstIdx++] = Math.min(255, Math.max(0, Math.round(pixel)));
            srcIdx += hwStride;
        }
    }
}

// ── Extract RGB from ImageData (4-byte RGBA → 3-byte RGB) ──────────────
// Canvas getImageData always returns RGBA. Most ML models expect RGB only.
function imageDataToRGB(imageData) {
    const src = imageData.data;
    const pixelCount = imageData.width * imageData.height;
    const rgb = new Uint8Array(pixelCount * 3);
    for (let i = 0; i < pixelCount; i++) {
        const srcOff = i * 4;
        const dstOff = i * 3;
        rgb[dstOff]     = src[srcOff];     // R
        rgb[dstOff + 1] = src[srcOff + 1]; // G
        rgb[dstOff + 2] = src[srcOff + 2]; // B
    }
    return rgb;
}

// ── Clamp utility ────────────────────────────────────────────────────────
function clamp(val, lo, hi) {
    return Math.max(lo, Math.min(hi, val));
}

// ── Intersection-over-Union ──────────────────────────────────────────────
// Boxes: { x, y, width, height } (x,y = top-left)
function computeIoU(a, b) {
    const ax1 = a.x, ay1 = a.y;
    const ax2 = a.x + a.width, ay2 = a.y + a.height;
    const bx1 = b.x, by1 = b.y;
    const bx2 = b.x + b.width, by2 = b.y + b.height;

    const xx1 = Math.max(ax1, bx1);
    const yy1 = Math.max(ay1, by1);
    const xx2 = Math.min(ax2, bx2);
    const yy2 = Math.min(ay2, by2);

    const w = Math.max(0, xx2 - xx1);
    const h = Math.max(0, yy2 - yy1);
    const inter = w * h;

    const areaA = a.width * a.height;
    const areaB = b.width * b.height;
    const union = areaA + areaB - inter;

    return union > 0 ? inter / union : 0;
}

// ── Non-Maximum Suppression (sorted by score descending) ──────────────────
// Matches C++ NmsSortedBboxes in YoloDetector_v7_face.cpp (IoU threshold)
function nmsSortedBboxes(boxes, iouThreshold) {
    if (!boxes || boxes.length === 0) return [];

    // Sort by score descending
    const sorted = [...boxes].sort((a, b) => b.score - a.score);
    const areas = sorted.map(b => b.width * b.height);
    const suppressed = new Array(sorted.length).fill(false);
    const result = [];

    for (let i = 0; i < sorted.length; i++) {
        if (suppressed[i]) continue;
        result.push(sorted[i]);
        for (let j = i + 1; j < sorted.length; j++) {
            if (suppressed[j]) continue;
            const xx1 = Math.max(sorted[i].x, sorted[j].x);
            const yy1 = Math.max(sorted[i].y, sorted[j].y);
            const xx2 = Math.min(sorted[i].x + sorted[i].width, sorted[j].x + sorted[j].width);
            const yy2 = Math.min(sorted[i].y + sorted[i].height, sorted[j].y + sorted[j].height);
            const w = Math.max(0, xx2 - xx1 + 1);
            const h = Math.max(0, yy2 - yy1 + 1);
            const inter = w * h;
            const ovr = inter / (areas[i] + areas[j] - inter);
            if (ovr >= iouThreshold) {
                suppressed[j] = true;
            }
        }
    }
    return result;
}

// ── estimateAffinePartial2D — similarity transform (4-DOF) ────────────────
// Matches C++ cv::estimateAffinePartial2D(pts, mFaceTemplate, cv::noArray(), cv::LMEDS)
//
// A similarity transform has the form:
//   u = a*x - b*y + c
//   v = b*x + a*y + d
//
// where s = sqrt(a²+b²) is uniform scale, θ = atan2(b,a) is rotation.
//
// Solves via least squares from corresponding point pairs.
function estimateAffinePartial2D(fromPts, toPts) {
    if (fromPts.length !== toPts.length || fromPts.length < 2) {
        throw new Error('Need at least 2 point pairs for similarity transform');
    }

    const n = fromPts.length;

    // Build normal equations for:  [Σ(x²+y²)       0     Σx  Σy ] [a]   [Σ(x*u + y*v)]
    //                              [      0   Σ(x²+y²)   -Σy  Σx ] [b] = [Σ(x*v - y*u)]
    //                              [     Σx       -Σy     n   0 ] [c]   [Σu]
    //                              [     Σy        Σx     0   n ] [d]   [Σv]
    //
    // Where (x,y) = fromPts, (u,v) = toPts

    let Sx = 0, Sy = 0, Su = 0, Sv = 0;
    let Sx2y2 = 0;
    let Sxu_yv = 0, Sxv_yu = 0;

    for (let i = 0; i < n; i++) {
        const x = fromPts[i][0], y = fromPts[i][1];
        const u = toPts[i][0],   v = toPts[i][1];

        Sx += x; Sy += y;
        Su += u; Sv += v;
        Sx2y2 += x * x + y * y;
        Sxu_yv += x * u + y * v;
        Sxv_yu += x * v - y * u;
    }

    // Solve the 4x4 system.  Since it decouples into two 2x2 blocks,
    // we can solve directly:
    //
    // [Sx2y2     0  ] [a] + [ Sx  Sy ] [c] = [Sxu_yv]
    // [   0   Sx2y2] [b]   [-Sy  Sx ] [d]   [Sxv_yu]
    //
    // [ Sx  -Sy ] [a] + [n  0] [c] = [Su]
    // [ Sy   Sx ] [b]   [0  n] [d]   [Sv]

    // First solve for [c, d] in terms of [a, b]:
    // c = (Su - Sx*a + Sy*b) / n
    // d = (Sv - Sy*a - Sx*b) / n

    // Substitute back:
    // Sx2y2*a + Sx*c + Sy*d = Sxu_yv
    // Sx2y2*b - Sy*c + Sx*d = Sxv_yu

    // After substitution and simplification:
    // (n*Sx2y2 - Sx² - Sy²) * a = n*Sxu_yv - Sx*Su - Sy*Sv
    // (n*Sx2y2 - Sx² - Sy²) * b = n*Sxv_yu + Sy*Su - Sx*Sv

    const det = n * Sx2y2 - Sx * Sx - Sy * Sy;

    if (Math.abs(det) < 1e-10) {
        // Fallback: identity transform
        return [1, 0, 0, 0, 1, 0];
    }

    const a = (n * Sxu_yv - Sx * Su - Sy * Sv) / det;
    const b = (n * Sxv_yu + Sy * Su - Sx * Sv) / det;
    const c = (Su - Sx * a + Sy * b) / n;
    const d = (Sv - Sy * a - Sx * b) / n;

    // Return [a, b, c, d] representing:
    // | a  -b   c |
    // | b   a   d |
    // In OpenCV 2x3 matrix format (row-major):
    // [a, -b, c, b, a, d]
    return [a, -b, c, b, a, d];
}

// ── invertAffineTransform ─────────────────────────────────────────────────
// Inverts a 2x3 affine matrix [m00,m01,m02, m10,m11,m12]
function invertAffineTransform(M) {
    const det = M[0] * M[4] - M[1] * M[3];
    if (Math.abs(det) < 1e-15) {
        throw new Error('Affine matrix is singular');
    }
    const invDet = 1.0 / det;
    return [
        M[4] * invDet,           -M[1] * invDet,
        (M[1] * M[5] - M[4] * M[2]) * invDet,
        -M[3] * invDet,           M[0] * invDet,
        (M[3] * M[2] - M[0] * M[5]) * invDet
    ];
}

// ── normalizeAffineTransform ──────────────────────────────────────────────
// Converts resolution-dependent affine matrix to [0,1] normalized space.
// Matches C++: M_norm = S_dst_inv * M * S_src
//   S_src = diag(src_w, src_h, 1)
//   S_dst_inv = diag(1/dst_w, 1/dst_h, 1)
function normalizeAffineTransform(M, srcW, srcH, dstW, dstH) {
    // M is [m00, m01, m02, m10, m11, m12] (2x3 row-major)
    const m00 = M[0], m01 = M[1], m02 = M[2];
    const m10 = M[3], m11 = M[4], m12 = M[5];

    // M_norm = S_dst_inv * M * S_src
    // Row 0: [(m00*srcW)/dstW, (m01*srcH)/dstW, m02/dstW]
    // Row 1: [(m10*srcW)/dstH, (m11*srcH)/dstH, m12/dstH]
    return [
        (m00 * srcW) / dstW, (m01 * srcH) / dstW, m02 / dstW,
        (m10 * srcW) / dstH, (m11 * srcH) / dstH, m12 / dstH
    ];
}

// ── denormalizeAffineTransform ────────────────────────────────────────────
// Converts normalized [0,1]-space affine matrix back to pixel space.
// Matches C++: M_pixel = S_dst * M_norm * S_src_inv
//   S_dst = diag(dst_w, dst_h, 1)
//   S_src_inv = diag(1/src_w, 1/src_h, 1)
function denormalizeAffineTransform(Mnorm, srcW, srcH, dstW, dstH) {
    const m00 = Mnorm[0], m01 = Mnorm[1], m02 = Mnorm[2];
    const m10 = Mnorm[3], m11 = Mnorm[4], m12 = Mnorm[5];

    // M_pixel = S_dst * M_norm * S_src_inv
    // Row 0: [(m00*dstW)/srcW, (m01*dstW)/srcH, m02*dstW]
    // Row 1: [(m10*dstH)/srcW, (m11*dstH)/srcH, m12*dstH]
    return [
        (m00 * dstW) / srcW, (m01 * dstW) / srcH, m02 * dstW,
        (m10 * dstH) / srcW, (m11 * dstH) / srcH, m12 * dstH
    ];
}

// ── Distance between two 2D points ────────────────────────────────────────
function distanceBetweenTwoPoints(x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    return Math.sqrt(dx * dx + dy * dy);
}

// ── Overlap score (intersection area / min(area1, area2)) ─────────────────
// Matches C++ FaceEnhancer::overlapScore
function overlapScore(rect1, rect2) {
    // rect1 and rect2 are Rect2DInfo: anchor{x,y} is top-left, size{x,y} = w,h
    // Note: in the C++ code, the coordinate system has Y inverted
    // rect.anchor = (center.x - size.x*0.5, ...) in normalized space
    // For our purposes (IoU-like), orientation doesn't matter — we just compute overlaps.
    const r1Left = rect1.anchor.x, r1Right = rect1.anchor.x + rect1.size.x;
    const r2Left = rect2.anchor.x, r2Right = rect2.anchor.x + rect2.size.x;
    const r1Top = rect1.anchor.y, r1Bottom = rect1.anchor.y + rect1.size.y;
    const r2Top = rect2.anchor.y, r2Bottom = rect2.anchor.y + rect2.size.y;

    const interLeft = Math.max(r1Left, r2Left);
    const interRight = Math.min(r1Right, r2Right);
    const interWidth = interRight - interLeft;
    if (interWidth <= 0) return 0;

    const interTop = Math.max(r1Top, r2Top);
    const interBottom = Math.min(r1Bottom, r2Bottom);
    const interHeight = interBottom - interTop;
    if (interHeight <= 0) return 0;

    const interArea = interWidth * interHeight;
    const area1 = rect1.size.x * rect1.size.y;
    const area2 = rect2.size.x * rect2.size.y;
    const minArea = Math.min(area1, area2);
    if (minArea <= 0) return 0;

    return interArea / minArea;
}

// ── convexHull (Graham scan) for boundingRect of mask ─────────────────────
function convexHull(points) {
    if (points.length < 3) return points;
    // Find lowest point
    let lowest = 0;
    for (let i = 1; i < points.length; i++) {
        if (points[i][1] < points[lowest][1] ||
            (points[i][1] === points[lowest][1] && points[i][0] < points[lowest][0])) {
            lowest = i;
        }
    }
    // Sort by polar angle
    const p0 = points[lowest];
    const sorted = points.filter((_, i) => i !== lowest).sort((a, b) => {
        const cross = (a[0] - p0[0]) * (b[1] - p0[1]) - (a[1] - p0[1]) * (b[0] - p0[0]);
        if (cross !== 0) return -cross; // counter-clockwise first
        const da = (a[0] - p0[0]) ** 2 + (a[1] - p0[1]) ** 2;
        const db = (b[0] - p0[0]) ** 2 + (b[1] - p0[1]) ** 2;
        return da - db;
    });

    const hull = [p0];
    for (const p of sorted) {
        while (hull.length >= 2) {
            const a = hull[hull.length - 2];
            const b = hull[hull.length - 1];
            const cross = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
            if (cross > 0) break;
            hull.pop();
        }
        hull.push(p);
    }
    return hull;
}

// ── boundingRect from points ──────────────────────────────────────────────
function boundingRect(pts) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of pts) {
        minX = Math.min(minX, p[0]);
        minY = Math.min(minY, p[1]);
        maxX = Math.max(maxX, p[0]);
        maxY = Math.max(maxY, p[1]);
    }
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

// ── Format duration for logging ───────────────────────────────────────────
function formatMs(ms) {
    return ms < 1000 ? `${ms.toFixed(0)}ms` : `${(ms / 1000).toFixed(2)}s`;
}

// Export for use in other modules (loaded via <script> tags in order)
// In a module system these would be imports; with script tags they're globals.
