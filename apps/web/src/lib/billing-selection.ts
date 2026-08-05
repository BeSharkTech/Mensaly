export type BillableStudent = {
  id: string;
  status: string;
  enrollmentId?: string | null;
  planId?: string | null;
};

export function filterBillableStudents<T extends BillableStudent>(students: T[], planId: string) {
  return students.filter(
    (student) =>
      student.status === "ACTIVE" &&
      Boolean(student.enrollmentId) &&
      (planId === "ALL" || student.planId === planId),
  );
}

export function toggleVisibleStudentSelection(
  selectedIds: string[],
  visibleIds: string[],
  checked: boolean,
) {
  if (checked) return [...new Set([...selectedIds, ...visibleIds])];
  const visible = new Set(visibleIds);
  return selectedIds.filter((id) => !visible.has(id));
}
