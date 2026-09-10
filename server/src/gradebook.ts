// Pure final-grade computation -- no database, no side effects, unit-tested directly (see
// phase2b2-qa-spec.md §2). Both the JSON gradebook view and the CSV export call this same
// function so there is exactly one place the arithmetic can go wrong.
//
// Algorithm (phase2b2-product-spec.md):
// 1. Within a Category, combine a student's scores points-weighted: sum(pointsEarned) /
//    sum(maxPoints) across only the Assignments in that Category that have a Score for this
//    student. An unscored Assignment contributes to neither sum.
// 2. A Category with zero scored Assignments for this student is "inactive" and excluded --
//    never treated as 0%.
// 3. Only active Categories count toward the final grade. Their weights are normalized
//    proportionally among just the active set (dividing by the sum of active weights, rather
//    than by 100, achieves this without a separate normalization step).
// 4. finalGrade = sum(categoryPercent * weight) / sum(weight), across active Categories only.
// 5. A student with no scored Assignments anywhere in the Section has finalGrade = null, not 0.

export interface CategoryInput {
  id: string;
  weight: number;
}

export interface AssignmentInput {
  id: string;
  categoryId: string;
  maxPoints: number;
}

export interface ScoreInput {
  assignmentId: string;
  userId: string;
  pointsEarned: number;
}

export interface StudentGrade {
  userId: string;
  categoryPercentages: Map<string, number>;
  finalGrade: number | null;
}

export function computeGrades(
  categories: CategoryInput[],
  assignments: AssignmentInput[],
  scores: ScoreInput[],
  studentUserIds: string[],
): StudentGrade[] {
  const assignmentsByCategory = new Map<string, AssignmentInput[]>();
  for (const assignment of assignments) {
    const list = assignmentsByCategory.get(assignment.categoryId) ?? [];
    list.push(assignment);
    assignmentsByCategory.set(assignment.categoryId, list);
  }

  const scoresByUser = new Map<string, Map<string, number>>();
  for (const score of scores) {
    const byAssignment = scoresByUser.get(score.userId) ?? new Map<string, number>();
    byAssignment.set(score.assignmentId, score.pointsEarned);
    scoresByUser.set(score.userId, byAssignment);
  }

  return studentUserIds.map((userId) => {
    const userScores = scoresByUser.get(userId) ?? new Map<string, number>();
    const categoryPercentages = new Map<string, number>();
    let weightedSum = 0;
    let activeWeight = 0;

    for (const category of categories) {
      const categoryAssignments = assignmentsByCategory.get(category.id) ?? [];
      let sumEarned = 0;
      let sumMax = 0;
      for (const assignment of categoryAssignments) {
        const earned = userScores.get(assignment.id);
        if (earned === undefined) continue;
        sumEarned += earned;
        sumMax += assignment.maxPoints;
      }
      if (sumMax <= 0) continue;

      const categoryPercent = (sumEarned / sumMax) * 100;
      categoryPercentages.set(category.id, categoryPercent);
      weightedSum += categoryPercent * category.weight;
      activeWeight += category.weight;
    }

    const finalGrade = activeWeight > 0 ? weightedSum / activeWeight : null;
    return { userId, categoryPercentages, finalGrade };
  });
}
