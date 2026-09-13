import type { SVGProps } from 'react';

function Svg(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    />
  );
}

export const IconTables = (p: SVGProps<SVGSVGElement>) => (
  <Svg {...p}>
    <circle cx="8" cy="7" r="3.2" />
    <circle cx="17" cy="9" r="2.4" />
    <path d="M8 10.5V19M5.5 19h5M17 11.5V19M14.8 19h4.4M2.5 16.5h5" />
  </Svg>
);

export const IconKitchen = (p: SVGProps<SVGSVGElement>) => (
  <Svg {...p}>
    <path d="M4 21V9a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v12" />
    <path d="M2 21h20" />
    <path d="M9 5V3M12 5V3M15 5V3" />
    <path d="M9.5 9h5M9.5 13h5" />
  </Svg>
);

export const IconOrders = (p: SVGProps<SVGSVGElement>) => (
  <Svg {...p}>
    <rect x="4" y="3" width="16" height="18" rx="2.5" />
    <path d="M8.5 8h7M8.5 12h7M8.5 16h4" />
  </Svg>
);

export const IconReport = (p: SVGProps<SVGSVGElement>) => (
  <Svg {...p}>
    <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
  </Svg>
);

export const IconExpense = (p: SVGProps<SVGSVGElement>) => (
  <Svg {...p}>
    <rect x="2.5" y="6" width="19" height="12" rx="2" />
    <circle cx="12" cy="12" r="2.6" />
    <path d="M6 9.5h.01M18 14.5h.01" />
  </Svg>
);

export const IconMenu = (p: SVGProps<SVGSVGElement>) => (
  <Svg {...p}>
    <path d="M5 5h14M5 12h14M5 19h9" />
  </Svg>
);

export const IconGear = (p: SVGProps<SVGSVGElement>) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3.2" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.1-1.55 1.7 1.7 0 0 0-1.88.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1.1 1.7 1.7 0 0 0-.34-1.88l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.01a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55h.01a1.7 1.7 0 0 0 1.88-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.01a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1z" />
  </Svg>
);

export const IconCash = (p: SVGProps<SVGSVGElement>) => (
  <Svg {...p}>
    <rect x="2.5" y="6" width="19" height="12.5" rx="2.5" />
    <circle cx="12" cy="12.25" r="2.6" />
    <path d="M6 9.5v.01M18 15v.01" />
  </Svg>
);

export const IconUpi = (p: SVGProps<SVGSVGElement>) => (
  <Svg {...p}>
    <rect x="3" y="5" width="18" height="14" rx="3" />
    <path d="M7.5 9.5l2.2 5 2.2-5M13.5 14.5V9.5M16.2 9.5v5" />
  </Svg>
);

export const IconCard = (p: SVGProps<SVGSVGElement>) => (
  <Svg {...p}>
    <rect x="2.5" y="5" width="19" height="14" rx="2.5" />
    <path d="M2.5 9.5h19" />
    <path d="M6 14h4" />
  </Svg>
);

export const IconBack = (p: SVGProps<SVGSVGElement>) => (
  <Svg {...p}>
    <path d="M15 5l-7 7 7 7" />
  </Svg>
);

export const IconPlus = (p: SVGProps<SVGSVGElement>) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);

export const IconTrash = (p: SVGProps<SVGSVGElement>) => (
  <Svg {...p}>
    <path d="M4 7h16M9.5 7V5h5v2M6.5 7l1 13h9l1-13" />
  </Svg>
);

export const IconPrint = (p: SVGProps<SVGSVGElement>) => (
  <Svg {...p}>
    <path d="M7 8V3h10v5" />
    <rect x="3" y="8" width="18" height="9" rx="2" />
    <path d="M7 14h10v7H7z" />
  </Svg>
);

export const IconQr = (p: SVGProps<SVGSVGElement>) => (
  <Svg {...p}>
    <rect x="3.5" y="3.5" width="7" height="7" rx="1" />
    <rect x="13.5" y="3.5" width="7" height="7" rx="1" />
    <rect x="3.5" y="13.5" width="7" height="7" rx="1" />
    <path d="M13.5 13.5h3v3h-3zM17 17h3.5v3.5H17zM20.5 13.5H20M17 20.5h.01" />
  </Svg>
);

export const IconCheck = (p: SVGProps<SVGSVGElement>) => (
  <Svg {...p}>
    <path d="M4.5 12.5l5 5 10-11" />
  </Svg>
);

export const IconClose = (p: SVGProps<SVGSVGElement>) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Svg>
);

export const IconLogout = (p: SVGProps<SVGSVGElement>) => (
  <Svg {...p}>
    <path d="M14 4h5a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-5" />
    <path d="M10 8l-4 4 4 4M6 12h10" />
  </Svg>
);

export const IconEdit = (p: SVGProps<SVGSVGElement>) => (
  <Svg {...p}>
    <path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17z" />
    <path d="M14.5 6.5l3 3" />
  </Svg>
);

export const IconShare = (p: SVGProps<SVGSVGElement>) => (
  <Svg {...p}>
    <circle cx="18" cy="5" r="2.6" />
    <circle cx="6" cy="12" r="2.6" />
    <circle cx="18" cy="19" r="2.6" />
    <path d="M8.2 10.8l7.6-4.4M8.2 13.2l7.6 4.4" />
  </Svg>
);
