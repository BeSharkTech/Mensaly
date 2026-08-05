export type PublicEnrollmentFieldConfiguration = {
  studentBirthDateRequired: boolean;
  studentPhoneRequired: boolean;
  relationshipRequired: boolean;
  approvalMode: "SAFE" | "AUTOMATIC";
};

export function publicEnrollmentLinkForOrigin(
  link: string,
  browserOrigin?: string,
): string {
  if (!browserOrigin) return link;
  try {
    const configured = new URL(link);
    const current = new URL(browserOrigin);
    const localHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
    if (
      localHosts.has(configured.hostname) &&
      localHosts.has(current.hostname)
    ) {
      return new URL(
        `${configured.pathname}${configured.search}${configured.hash}`,
        current.origin,
      ).toString();
    }
  } catch {
    return link;
  }
  return link;
}

export type PublicEnrollmentFormSettings =
  | { configured: false }
  | {
      configured: true;
      active: boolean;
      link: string;
      fieldConfiguration: PublicEnrollmentFieldConfiguration;
      privacyNoticeVersion: string;
      updatedAt: string;
    };

export type PublicEnrollmentConfiguration = {
  business: {
    name: string;
    logoDataUrl: string | null;
    brandColor: string | null;
    city: string;
    segment: string;
  };
  fieldConfiguration: PublicEnrollmentFieldConfiguration;
  fields: Array<{
    id: string;
    label: string;
    type: "TEXT" | "NUMBER" | "DATE" | "SELECT" | "BOOLEAN";
    subject: "STUDENT" | "GUARDIAN";
    options: string[];
    required: boolean;
  }>;
  plans: Array<{
    id: string;
    name: string;
    description: string;
    amountCents: number;
    dueDay: number;
  }>;
  privacyNoticeVersion: string;
  privacyNotice: string;
};
