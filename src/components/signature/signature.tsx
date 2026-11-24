import { useEffect, useId, useRef, useState } from "react";
import styles from "./signature.module.css";

interface SignatureProps {
    className?: string;
    width?: number | string;
    height?: number | string;
}

export const Signature = ({
    className = "",
    width = "816",
    height = "265",
}: SignatureProps) => {
    const [isVisible, setIsVisible] = useState(false);
    const svgRef = useRef<SVGSVGElement>(null);
    // id único: mais de uma assinatura na página não disputa o mesmo gradiente
    const gradId = `sig-metal-${useId().replace(/:/g, "")}`;

    useEffect(() => {
        const currentRef = svgRef.current;
        if (!currentRef) return;

        const observer = new IntersectionObserver(
            ([entry]) => {
                setIsVisible(entry.isIntersecting);
            },
            { threshold: 0.1 }
        );

        observer.observe(currentRef);

        return () => {
            if (currentRef) {
                observer.unobserve(currentRef);
            }
        };
    }, []);

    return (
        <svg
            ref={svgRef}
            className={`${styles.signatureSvg} ${isVisible ? styles.animate : ""} ${className}`.trim()}
            width={width}
            height={height}
            viewBox="0 0 816 265"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
        >
            {/* metal líquido: faixas de luz e sombra que mudam suave ao longo
                do traço, como ouro derramado — sem brilho em volta */}
            <defs>
                <linearGradient
                    id={gradId}
                    gradientUnits="userSpaceOnUse"
                    x1="0"
                    y1="40"
                    x2="816"
                    y2="225"
                >
                    <stop offset="0" stopColor="#9a845a" />
                    <stop offset="0.1" stopColor="#c2a86f" />
                    <stop offset="0.17" stopColor="#d8c595" />
                    <stop offset="0.25" stopColor="#b29a69" />
                    <stop offset="0.36" stopColor="#8f7a52" />
                    <stop offset="0.48" stopColor="#c6aa70" />
                    <stop offset="0.54" stopColor="#ddcc9e" />
                    <stop offset="0.62" stopColor="#b8a06c" />
                    <stop offset="0.74" stopColor="#957f55" />
                    <stop offset="0.86" stopColor="#cdb684" />
                    <stop offset="0.93" stopColor="#bda26d" />
                    <stop offset="1" stopColor="#9a845a" />
                </linearGradient>
            </defs>
            <path
                pathLength="1"
                d="M644.219 2.28998C91.7192 244.29 131.719 272.623 209.719 259.29C268.219 249.29 435.56 203.387 509.219 172.79C541.719 159.29 641.817 114.997 548.219 141.79C458.719 167.41 307.886 207.29 276.219 222.29C264.608 227.79 270.219 228.79 288.219 222.29C351.639 199.388 487.719 90.29 548.219 61.29C582.103 45.0481 405.019 166.789 368.219 197.29C331.419 227.791 401.553 183.332 441.219 157.29C457.053 146.457 493.034 120.389 513.719 108.29C540.219 92.79 464.219 158.29 423.219 187.79C414.719 194.623 403.946 205.239 430.719 190.79C462.219 173.79 595.048 106.358 660.219 84.79C799.219 38.79 810.219 53.79 810.219 53.79C822.219 67.29 792.719 73.6233 768.719 78.29C732.719 85.29 263.386 199.123 0.219238 222.29"
                stroke={`url(#${gradId})`}
                strokeWidth="5"
            />
        </svg>
    );
};

export default Signature;
