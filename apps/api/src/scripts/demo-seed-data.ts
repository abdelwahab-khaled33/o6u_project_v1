export const DEMO_PASSWORD = 'Demo!2026';

export type DemoRole = 'doctor' | 'ta' | 'student';

export type DemoUser = {
  username: string;
  full_name: string;
  role: DemoRole;
  student_code?: string;
};

export type DemoSubject = { code: string; name: string };

export type DemoSection = { subjectCode: string; taUsername: string; name: string };

export type DemoEnrollment = {
  studentUsername: string;
  subjectCode: string;
  sectionName: string;
};

export type DemoDoctorAssignment = { doctorUsername: string; subjectCode: string };

export type DemoQuestion = {
  subjectCode: string;
  ownerUsername: string;
  ownerType: 'doctor' | 'ta_shared';
  text: string;
  questionType: 'mcq' | 'true_false';
  options: string[];
  correctAnswer: string;
  difficulty: 'easy' | 'medium' | 'hard';
  grade: number;
};

export type AttemptPlanEntry = 'submit' | 'auto_submitted' | 'in_progress' | 'not_started';

export type AttemptPlan = Partial<Record<AttemptPlanEntry, number>>;

export type ExamWindowSpec =
  | { kind: 'ended'; startDaysAgo: number; windowMinutes: number }
  | { kind: 'future'; startDaysAhead: number; windowMinutes: number }
  | { kind: 'open'; startMinutesAgo: number; endDaysAhead: number };

export type DemoExam = {
  key: string;
  title: string;
  subjectCode: string;
  ownerUsername: string;
  type: 'doctor_exam' | 'ta_quiz';
  status: 'approved' | 'pending_approval' | 'rejected';
  rejectionReason?: string;
  quizSource?: 'own_questions';
  targetSections?: string[];
  mix: { easy: number; medium: number; hard: number };
  pointsPerQuestion: number;
  durationMinutes: number;
  window: ExamWindowSpec;
  attemptPlan?: AttemptPlan;
  compensation?: boolean;
};

export const demoUsers: DemoUser[] = [
  { username: 'dr.hassan', full_name: 'Hassan Kamal', role: 'doctor' },
  { username: 'dr.sara', full_name: 'Sara Adel', role: 'doctor' },
  { username: 'dr.omar', full_name: 'Omar Farouk', role: 'doctor' },
  { username: 'ta.nour', full_name: 'Nour Adly', role: 'ta' },
  { username: 'ta.mariam', full_name: 'Mariam Zaki', role: 'ta' },
  { username: 'ta.youssef', full_name: 'Youssef Rashad', role: 'ta' },
  { username: 'stu01', full_name: 'Ahmed Hassan', role: 'student', student_code: 'STU1001' },
  { username: 'stu02', full_name: 'Mona Said', role: 'student', student_code: 'STU1002' },
  { username: 'stu03', full_name: 'Khaled Omar', role: 'student', student_code: 'STU1003' },
  { username: 'stu04', full_name: 'Nada Ibrahim', role: 'student', student_code: 'STU1004' },
  { username: 'stu05', full_name: 'Mostafa Ali', role: 'student', student_code: 'STU1005' },
  { username: 'stu06', full_name: 'Laila Mahmoud', role: 'student', student_code: 'STU1006' },
  { username: 'stu07', full_name: 'Yara Mostafa', role: 'student', student_code: 'STU1007' },
  { username: 'stu08', full_name: 'Omar Sherif', role: 'student', student_code: 'STU1008' },
  { username: 'stu09', full_name: 'Hana Nabil', role: 'student', student_code: 'STU1009' },
  { username: 'stu10', full_name: 'Ziad Ashraf', role: 'student', student_code: 'STU1010' },
  { username: 'stu11', full_name: 'Salma Fouad', role: 'student', student_code: 'STU1011' },
  { username: 'stu12', full_name: 'Tarek Amin', role: 'student', student_code: 'STU1012' },
  { username: 'stu13', full_name: 'Rania Adel', role: 'student', student_code: 'STU1013' },
  { username: 'stu14', full_name: 'Amr Nasser', role: 'student', student_code: 'STU1014' },
  { username: 'stu15', full_name: 'Dina Waleed', role: 'student', student_code: 'STU1015' },
  { username: 'stu16', full_name: 'Hossam Gamal', role: 'student', student_code: 'STU1016' },
  { username: 'stu17', full_name: 'Aya Samir', role: 'student', student_code: 'STU1017' },
  { username: 'stu18', full_name: 'Seif Eldeen', role: 'student', student_code: 'STU1018' },
];

export const demoSubjects: DemoSubject[] = [
  { code: 'CS301', name: 'Data Structures' },
  { code: 'CS415', name: 'Software Engineering' },
  { code: 'MATH201', name: 'Probability and Statistics' },
];

const rosterRange = (from: number, to: number): string[] =>
  Array.from({ length: to - from + 1 }, (_, i) => `stu${String(from + i).padStart(2, '0')}`);

const sectionRoster = [
  { subjectCode: 'CS301', taUsername: 'ta.nour', name: 'Section A', from: 1, to: 6 },
  { subjectCode: 'CS301', taUsername: 'ta.mariam', name: 'Section B', from: 7, to: 12 },
  { subjectCode: 'CS415', taUsername: 'ta.youssef', name: 'Section A', from: 7, to: 12 },
  { subjectCode: 'CS415', taUsername: 'ta.mariam', name: 'Section B', from: 13, to: 18 },
  { subjectCode: 'MATH201', taUsername: 'ta.youssef', name: 'Section A', from: 1, to: 6 },
  { subjectCode: 'MATH201', taUsername: 'ta.nour', name: 'Section B', from: 13, to: 18 },
];

export const demoSections: DemoSection[] = sectionRoster.map(
  ({ subjectCode, taUsername, name }) => ({ subjectCode, taUsername, name }),
);

export const demoEnrollments: DemoEnrollment[] = sectionRoster.flatMap(({ subjectCode, name, from, to }) =>
  rosterRange(from, to).map((studentUsername) => ({ studentUsername, subjectCode, sectionName: name })),
);

export const demoDoctorAssignments: DemoDoctorAssignment[] = [
  { doctorUsername: 'dr.hassan', subjectCode: 'CS301' },
  { doctorUsername: 'dr.sara', subjectCode: 'CS415' },
  { doctorUsername: 'dr.omar', subjectCode: 'MATH201' },
];

export const demoQuestions: DemoQuestion[] = [
  { subjectCode: 'CS301', ownerUsername: 'dr.hassan', ownerType: 'doctor', text: 'Which data structure follows the LIFO principle?', questionType: 'mcq', options: ['Stack', 'Queue', 'Heap', 'Graph'], correctAnswer: 'Stack', difficulty: 'easy', grade: 2 },
  { subjectCode: 'CS301', ownerUsername: 'dr.hassan', ownerType: 'doctor', text: 'What is the time complexity of accessing an array element by index?', questionType: 'mcq', options: ['O(1)', 'O(n)', 'O(log n)', 'O(n squared)'], correctAnswer: 'O(1)', difficulty: 'easy', grade: 2 },
  { subjectCode: 'CS301', ownerUsername: 'dr.hassan', ownerType: 'doctor', text: 'A queue follows the FIFO principle.', questionType: 'true_false', options: [], correctAnswer: 'true', difficulty: 'easy', grade: 2 },
  { subjectCode: 'CS301', ownerUsername: 'dr.hassan', ownerType: 'doctor', text: 'Which of these is a linear data structure?', questionType: 'mcq', options: ['Array', 'Tree', 'Graph', 'Heap'], correctAnswer: 'Array', difficulty: 'easy', grade: 2 },
  { subjectCode: 'CS301', ownerUsername: 'dr.hassan', ownerType: 'doctor', text: 'What is the worst-case search time in a balanced binary search tree?', questionType: 'mcq', options: ['O(1)', 'O(log n)', 'O(n)', 'O(n log n)'], correctAnswer: 'O(log n)', difficulty: 'medium', grade: 2 },
  { subjectCode: 'CS301', ownerUsername: 'dr.hassan', ownerType: 'doctor', text: 'Which binary search tree traversal visits nodes in ascending order?', questionType: 'mcq', options: ['Inorder', 'Preorder', 'Postorder', 'Level order'], correctAnswer: 'Inorder', difficulty: 'medium', grade: 2 },
  { subjectCode: 'CS301', ownerUsername: 'dr.hassan', ownerType: 'doctor', text: 'In a min-heap the smallest element is stored at the root.', questionType: 'true_false', options: [], correctAnswer: 'true', difficulty: 'medium', grade: 2 },
  { subjectCode: 'CS301', ownerUsername: 'dr.hassan', ownerType: 'doctor', text: 'What is the maximum number of children of a node in a binary tree?', questionType: 'mcq', options: ['1', '2', '3', '4'], correctAnswer: '2', difficulty: 'medium', grade: 2 },
  { subjectCode: 'CS301', ownerUsername: 'dr.hassan', ownerType: 'doctor', text: 'What is the worst-case time complexity of quicksort?', questionType: 'mcq', options: ['O(n)', 'O(n log n)', 'O(n squared)', 'O(log n)'], correctAnswer: 'O(n squared)', difficulty: 'hard', grade: 2 },
  { subjectCode: 'CS301', ownerUsername: 'dr.hassan', ownerType: 'doctor', text: 'With separate chaining, what happens when two keys hash to the same index?', questionType: 'mcq', options: ['Both entries are stored in the same bucket through a linked list', 'The table is rehashed immediately', 'The insert fails', 'The keys are renamed'], correctAnswer: 'Both entries are stored in the same bucket through a linked list', difficulty: 'hard', grade: 2 },
  { subjectCode: 'CS301', ownerUsername: 'dr.hassan', ownerType: 'doctor', text: 'Dijkstra algorithm does not work correctly with negative-weight edges.', questionType: 'true_false', options: [], correctAnswer: 'true', difficulty: 'hard', grade: 2 },
  { subjectCode: 'CS301', ownerUsername: 'dr.hassan', ownerType: 'doctor', text: 'What is the amortized time complexity of appending to a dynamic array?', questionType: 'mcq', options: ['O(1)', 'O(n)', 'O(log n)', 'O(n log n)'], correctAnswer: 'O(1)', difficulty: 'hard', grade: 2 },

  { subjectCode: 'CS415', ownerUsername: 'dr.sara', ownerType: 'doctor', text: 'Which design pattern exposes a single global access point to a resource?', questionType: 'mcq', options: ['Singleton', 'Factory', 'Observer', 'Adapter'], correctAnswer: 'Singleton', difficulty: 'easy', grade: 2 },
  { subjectCode: 'CS415', ownerUsername: 'dr.sara', ownerType: 'doctor', text: 'Which SOLID principle says a class should have only one reason to change?', questionType: 'mcq', options: ['Single responsibility', 'Open-closed', 'Liskov substitution', 'Interface segregation'], correctAnswer: 'Single responsibility', difficulty: 'easy', grade: 2 },
  { subjectCode: 'CS415', ownerUsername: 'dr.sara', ownerType: 'doctor', text: 'Unit tests should be independent of each other.', questionType: 'true_false', options: [], correctAnswer: 'true', difficulty: 'easy', grade: 2 },
  { subjectCode: 'CS415', ownerUsername: 'dr.sara', ownerType: 'doctor', text: 'Which of these is a version control system?', questionType: 'mcq', options: ['Git', 'Jenkins', 'Docker', 'Kubernetes'], correctAnswer: 'Git', difficulty: 'easy', grade: 2 },
  { subjectCode: 'CS415', ownerUsername: 'dr.sara', ownerType: 'doctor', text: 'The Observer pattern is also known by which other name?', questionType: 'mcq', options: ['Publish-Subscribe', 'Pipeline', 'Decorator', 'Facade'], correctAnswer: 'Publish-Subscribe', difficulty: 'medium', grade: 2 },
  { subjectCode: 'CS415', ownerUsername: 'dr.sara', ownerType: 'doctor', text: 'The open-closed principle allows extending behaviour without modifying existing code.', questionType: 'true_false', options: [], correctAnswer: 'true', difficulty: 'medium', grade: 2 },
  { subjectCode: 'CS415', ownerUsername: 'dr.sara', ownerType: 'doctor', text: 'Which testing level exercises individual functions or methods in isolation?', questionType: 'mcq', options: ['Unit testing', 'Integration testing', 'System testing', 'Acceptance testing'], correctAnswer: 'Unit testing', difficulty: 'medium', grade: 2 },
  { subjectCode: 'CS415', ownerUsername: 'dr.sara', ownerType: 'doctor', text: 'What is the main purpose of a daily stand-up meeting in Scrum?', questionType: 'mcq', options: ['Report progress and plan the day work', 'Design the system architecture', 'Write code together', 'Deploy to production'], correctAnswer: 'Report progress and plan the day work', difficulty: 'medium', grade: 2 },
  { subjectCode: 'CS415', ownerUsername: 'dr.sara', ownerType: 'doctor', text: 'Which pattern converts a class interface into the interface clients expect?', questionType: 'mcq', options: ['Adapter', 'Bridge', 'Facade', 'Proxy'], correctAnswer: 'Adapter', difficulty: 'hard', grade: 2 },
  { subjectCode: 'CS415', ownerUsername: 'dr.sara', ownerType: 'doctor', text: 'A refactor changes the external behaviour of the software.', questionType: 'true_false', options: [], correctAnswer: 'false', difficulty: 'hard', grade: 2 },
  { subjectCode: 'CS415', ownerUsername: 'dr.sara', ownerType: 'doctor', text: 'Under the dependency inversion principle, high-level modules should depend on what?', questionType: 'mcq', options: ['Abstractions', 'Low-level modules', 'Concrete classes', 'Other high-level modules'], correctAnswer: 'Abstractions', difficulty: 'hard', grade: 2 },
  { subjectCode: 'CS415', ownerUsername: 'dr.sara', ownerType: 'doctor', text: 'Which metric counts the number of independent paths through code?', questionType: 'mcq', options: ['Cyclomatic complexity', 'Halstead length', 'Lines of code', 'Test coverage'], correctAnswer: 'Cyclomatic complexity', difficulty: 'hard', grade: 2 },

  { subjectCode: 'MATH201', ownerUsername: 'dr.omar', ownerType: 'doctor', text: 'What is the probability of getting heads when flipping a fair coin?', questionType: 'mcq', options: ['0.25', '0.5', '0.75', '1'], correctAnswer: '0.5', difficulty: 'easy', grade: 2 },
  { subjectCode: 'MATH201', ownerUsername: 'dr.omar', ownerType: 'doctor', text: 'The probabilities of all outcomes in a sample space add up to what value?', questionType: 'mcq', options: ['0', '0.5', '1', 'It depends on the experiment'], correctAnswer: '1', difficulty: 'easy', grade: 2 },
  { subjectCode: 'MATH201', ownerUsername: 'dr.omar', ownerType: 'doctor', text: 'Rolling two dice produces independent events.', questionType: 'true_false', options: [], correctAnswer: 'true', difficulty: 'easy', grade: 2 },
  { subjectCode: 'MATH201', ownerUsername: 'dr.omar', ownerType: 'doctor', text: 'How many outcomes does rolling a single fair six-sided die have?', questionType: 'mcq', options: ['4', '6', '8', '12'], correctAnswer: '6', difficulty: 'easy', grade: 2 },
  { subjectCode: 'MATH201', ownerUsername: 'dr.omar', ownerType: 'doctor', text: 'For independent events A and B, the probability of A and B equals which expression?', questionType: 'mcq', options: ['P(A) + P(B)', 'P(A) times P(B)', 'P(A) divided by P(B)', 'P(A) minus P(B)'], correctAnswer: 'P(A) times P(B)', difficulty: 'medium', grade: 2 },
  { subjectCode: 'MATH201', ownerUsername: 'dr.omar', ownerType: 'doctor', text: 'The mean of a data set always equals its median.', questionType: 'true_false', options: [], correctAnswer: 'false', difficulty: 'medium', grade: 2 },
  { subjectCode: 'MATH201', ownerUsername: 'dr.omar', ownerType: 'doctor', text: 'Which distribution models the number of successes in n independent Bernoulli trials?', questionType: 'mcq', options: ['Normal', 'Binomial', 'Poisson', 'Uniform'], correctAnswer: 'Binomial', difficulty: 'medium', grade: 2 },
  { subjectCode: 'MATH201', ownerUsername: 'dr.omar', ownerType: 'doctor', text: 'A fair six-sided die is rolled once; what is the probability of an even outcome?', questionType: 'mcq', options: ['1/6', '1/3', '1/2', '2/3'], correctAnswer: '1/2', difficulty: 'medium', grade: 2 },
  { subjectCode: 'MATH201', ownerUsername: 'dr.omar', ownerType: 'doctor', text: 'If P(A) equals 0.3 and P(B given A) equals 0.5, what is the probability of A and B?', questionType: 'mcq', options: ['0.15', '0.8', '0.2', '0.6'], correctAnswer: '0.15', difficulty: 'hard', grade: 2 },
  { subjectCode: 'MATH201', ownerUsername: 'dr.omar', ownerType: 'doctor', text: 'The correlation coefficient can be greater than 1 in magnitude.', questionType: 'true_false', options: [], correctAnswer: 'false', difficulty: 'hard', grade: 2 },
  { subjectCode: 'MATH201', ownerUsername: 'dr.omar', ownerType: 'doctor', text: 'Bayes theorem connects which two kinds of probability?', questionType: 'mcq', options: ['Conditional and marginal probabilities', 'Mean and variance', 'Sample and population', 'Two data sets'], correctAnswer: 'Conditional and marginal probabilities', difficulty: 'hard', grade: 2 },
  { subjectCode: 'MATH201', ownerUsername: 'dr.omar', ownerType: 'doctor', text: 'For a constant c, the variance of X plus c equals which expression?', questionType: 'mcq', options: ['Var(X)', 'Var(X) plus c', 'Var(X) times c', '0'], correctAnswer: 'Var(X)', difficulty: 'hard', grade: 2 },

  { subjectCode: 'CS301', ownerUsername: 'ta.nour', ownerType: 'ta_shared', text: 'Which data structure supports insertion and deletion at both ends?', questionType: 'mcq', options: ['Deque', 'Stack', 'Heap', 'Trie'], correctAnswer: 'Deque', difficulty: 'easy', grade: 2 },
  { subjectCode: 'CS301', ownerUsername: 'ta.nour', ownerType: 'ta_shared', text: 'A linked list stores its elements in contiguous memory locations.', questionType: 'true_false', options: [], correctAnswer: 'false', difficulty: 'easy', grade: 2 },
  { subjectCode: 'CS301', ownerUsername: 'ta.nour', ownerType: 'ta_shared', text: 'In a stack, the top pointer refers to which element?', questionType: 'mcq', options: ['The most recently inserted element', 'The first element ever inserted', 'The last element of the list', 'Always null'], correctAnswer: 'The most recently inserted element', difficulty: 'medium', grade: 2 },
  { subjectCode: 'CS301', ownerUsername: 'ta.nour', ownerType: 'ta_shared', text: 'Binary search requires the input array to be sorted.', questionType: 'true_false', options: [], correctAnswer: 'true', difficulty: 'medium', grade: 2 },
  { subjectCode: 'CS301', ownerUsername: 'ta.nour', ownerType: 'ta_shared', text: 'What is the worst-case complexity of inserting into an unbalanced BST with n nodes?', questionType: 'mcq', options: ['O(1)', 'O(log n)', 'O(n)', 'O(n log n)'], correctAnswer: 'O(n)', difficulty: 'hard', grade: 2 },
  { subjectCode: 'CS301', ownerUsername: 'ta.nour', ownerType: 'ta_shared', text: 'What is the time complexity of building a heap from an array of n elements?', questionType: 'mcq', options: ['O(n)', 'O(n log n)', 'O(log n)', 'O(n squared)'], correctAnswer: 'O(n)', difficulty: 'hard', grade: 2 },

  { subjectCode: 'MATH201', ownerUsername: 'ta.nour', ownerType: 'ta_shared', text: 'What is the probability of rolling a 3 on a fair six-sided die?', questionType: 'mcq', options: ['1/6', '1/3', '1/2', '1'], correctAnswer: '1/6', difficulty: 'easy', grade: 2 },
  { subjectCode: 'MATH201', ownerUsername: 'ta.nour', ownerType: 'ta_shared', text: 'An impossible event has probability 0.', questionType: 'true_false', options: [], correctAnswer: 'true', difficulty: 'easy', grade: 2 },
  { subjectCode: 'MATH201', ownerUsername: 'ta.nour', ownerType: 'ta_shared', text: 'Which of these is a measure of spread?', questionType: 'mcq', options: ['Standard deviation', 'Mean', 'Median', 'First quartile'], correctAnswer: 'Standard deviation', difficulty: 'medium', grade: 2 },
  { subjectCode: 'MATH201', ownerUsername: 'ta.nour', ownerType: 'ta_shared', text: 'The mode of a data set is its most frequent value.', questionType: 'true_false', options: [], correctAnswer: 'true', difficulty: 'medium', grade: 2 },
  { subjectCode: 'MATH201', ownerUsername: 'ta.nour', ownerType: 'ta_shared', text: 'Two events are mutually exclusive when which statement holds?', questionType: 'mcq', options: ['They cannot occur at the same time', 'They always occur together', 'They are independent', 'They have equal probability'], correctAnswer: 'They cannot occur at the same time', difficulty: 'hard', grade: 2 },
  { subjectCode: 'MATH201', ownerUsername: 'ta.nour', ownerType: 'ta_shared', text: 'What is the expected value of a fair six-sided die roll?', questionType: 'mcq', options: ['3', '3.5', '4', '2.5'], correctAnswer: '3.5', difficulty: 'hard', grade: 2 },

  { subjectCode: 'CS301', ownerUsername: 'ta.mariam', ownerType: 'ta_shared', text: 'Which of these is commonly used to implement a priority queue?', questionType: 'mcq', options: ['Heap', 'Stack', 'Queue', 'Graph'], correctAnswer: 'Heap', difficulty: 'easy', grade: 2 },
  { subjectCode: 'CS301', ownerUsername: 'ta.mariam', ownerType: 'ta_shared', text: 'Which data structure is used to implement the function call stack?', questionType: 'mcq', options: ['Stack', 'Queue', 'Heap', 'Array'], correctAnswer: 'Stack', difficulty: 'easy', grade: 2 },
  { subjectCode: 'CS301', ownerUsername: 'ta.mariam', ownerType: 'ta_shared', text: 'What is the average-case lookup time in a hash table with a good hash function?', questionType: 'mcq', options: ['O(1)', 'O(n)', 'O(log n)', 'O(n log n)'], correctAnswer: 'O(1)', difficulty: 'medium', grade: 2 },
  { subjectCode: 'CS301', ownerUsername: 'ta.mariam', ownerType: 'ta_shared', text: 'In a complete binary tree every level is completely filled except possibly the last.', questionType: 'true_false', options: [], correctAnswer: 'true', difficulty: 'medium', grade: 2 },
  { subjectCode: 'CS301', ownerUsername: 'ta.mariam', ownerType: 'ta_shared', text: 'What is the time complexity of depth-first search on a graph with V vertices and E edges?', questionType: 'mcq', options: ['O(V + E)', 'O(V squared)', 'O(E log V)', 'O(V times E)'], correctAnswer: 'O(V + E)', difficulty: 'hard', grade: 2 },
  { subjectCode: 'CS301', ownerUsername: 'ta.mariam', ownerType: 'ta_shared', text: 'Breadth-first search finds a shortest path in an unweighted graph.', questionType: 'true_false', options: [], correctAnswer: 'true', difficulty: 'hard', grade: 2 },

  { subjectCode: 'CS415', ownerUsername: 'ta.mariam', ownerType: 'ta_shared', text: 'Which Agile framework works with time-boxed iterations called sprints?', questionType: 'mcq', options: ['Scrum', 'Kanban', 'Waterfall', 'V-model'], correctAnswer: 'Scrum', difficulty: 'easy', grade: 2 },
  { subjectCode: 'CS415', ownerUsername: 'ta.mariam', ownerType: 'ta_shared', text: 'Continuous integration means merging code changes frequently.', questionType: 'true_false', options: [], correctAnswer: 'true', difficulty: 'easy', grade: 2 },
  { subjectCode: 'CS415', ownerUsername: 'ta.mariam', ownerType: 'ta_shared', text: 'What is a mock object used for in testing?', questionType: 'mcq', options: ['Simulating a dependency of the unit under test', 'Documenting the code', 'Optimizing queries', 'Compiling faster'], correctAnswer: 'Simulating a dependency of the unit under test', difficulty: 'medium', grade: 2 },
  { subjectCode: 'CS415', ownerUsername: 'ta.mariam', ownerType: 'ta_shared', text: 'The waterfall model is strictly iterative.', questionType: 'true_false', options: [], correctAnswer: 'false', difficulty: 'medium', grade: 2 },
  { subjectCode: 'CS415', ownerUsername: 'ta.mariam', ownerType: 'ta_shared', text: 'The interface segregation principle advises what?', questionType: 'mcq', options: ['Clients should not depend on interfaces they do not use', 'Classes should be open for extension but closed for modification', 'Depend on abstractions, not concretions', 'Subtypes must be substitutable for their base types'], correctAnswer: 'Clients should not depend on interfaces they do not use', difficulty: 'hard', grade: 2 },
  { subjectCode: 'CS415', ownerUsername: 'ta.mariam', ownerType: 'ta_shared', text: 'Which UML diagram shows object interactions arranged in time order?', questionType: 'mcq', options: ['Sequence diagram', 'Class diagram', 'Use case diagram', 'Deployment diagram'], correctAnswer: 'Sequence diagram', difficulty: 'hard', grade: 2 },

  { subjectCode: 'CS415', ownerUsername: 'ta.youssef', ownerType: 'ta_shared', text: 'Which pattern creates objects without exposing the instantiation logic?', questionType: 'mcq', options: ['Factory', 'Singleton', 'Observer', 'Strategy'], correctAnswer: 'Factory', difficulty: 'easy', grade: 2 },
  { subjectCode: 'CS415', ownerUsername: 'ta.youssef', ownerType: 'ta_shared', text: 'TDD stands for Test-Driven Development.', questionType: 'true_false', options: [], correctAnswer: 'true', difficulty: 'easy', grade: 2 },
  { subjectCode: 'CS415', ownerUsername: 'ta.youssef', ownerType: 'ta_shared', text: 'The strategy pattern is used to do what?', questionType: 'mcq', options: ['Encapsulate interchangeable algorithms behind a common interface', 'Stop event propagation', 'Convert old interfaces to new ones', 'Create subclasses lazily'], correctAnswer: 'Encapsulate interchangeable algorithms behind a common interface', difficulty: 'medium', grade: 2 },
  { subjectCode: 'CS415', ownerUsername: 'ta.youssef', ownerType: 'ta_shared', text: 'Every software requirement should be testable.', questionType: 'true_false', options: [], correctAnswer: 'true', difficulty: 'medium', grade: 2 },
  { subjectCode: 'CS415', ownerUsername: 'ta.youssef', ownerType: 'ta_shared', text: 'An anti-corruption layer in domain-driven design is used to do what?', questionType: 'mcq', options: ['Prevent coupling between a new model and a legacy system', 'Speed up database queries', 'Replace automated tests', 'Log runtime errors'], correctAnswer: 'Prevent coupling between a new model and a legacy system', difficulty: 'hard', grade: 2 },
  { subjectCode: 'CS415', ownerUsername: 'ta.youssef', ownerType: 'ta_shared', text: 'Legacy code is code without automated tests.', questionType: 'true_false', options: [], correctAnswer: 'true', difficulty: 'hard', grade: 2 },

  { subjectCode: 'MATH201', ownerUsername: 'ta.youssef', ownerType: 'ta_shared', text: 'The mean of a data set is also called its what?', questionType: 'mcq', options: ['Average', 'Median', 'Mode', 'Range'], correctAnswer: 'Average', difficulty: 'easy', grade: 2 },
  { subjectCode: 'MATH201', ownerUsername: 'ta.youssef', ownerType: 'ta_shared', text: '0 is a possible value for a probability.', questionType: 'true_false', options: [], correctAnswer: 'true', difficulty: 'easy', grade: 2 },
  { subjectCode: 'MATH201', ownerUsername: 'ta.youssef', ownerType: 'ta_shared', text: 'What is the median of the data set 3, 5, 7, 9, 11?', questionType: 'mcq', options: ['5', '7', '9', '3'], correctAnswer: '7', difficulty: 'medium', grade: 2 },
  { subjectCode: 'MATH201', ownerUsername: 'ta.youssef', ownerType: 'ta_shared', text: 'The standard deviation is the square root of which quantity?', questionType: 'mcq', options: ['The variance', 'The mean', 'The median', 'The range'], correctAnswer: 'The variance', difficulty: 'medium', grade: 2 },
  { subjectCode: 'MATH201', ownerUsername: 'ta.youssef', ownerType: 'ta_shared', text: 'For an approximately normal distribution, about 95% of the data lies within how many standard deviations of the mean?', questionType: 'mcq', options: ['1', '2', '3', '4'], correctAnswer: '2', difficulty: 'hard', grade: 2 },
  { subjectCode: 'MATH201', ownerUsername: 'ta.youssef', ownerType: 'ta_shared', text: 'A p-value of 0.03 is significant at the 0.05 significance level.', questionType: 'true_false', options: [], correctAnswer: 'true', difficulty: 'hard', grade: 2 },
];

export const demoExams: DemoExam[] = [
  {
    key: 'final-cs415',
    title: 'Final Exam - Software Engineering',
    subjectCode: 'CS415',
    ownerUsername: 'dr.sara',
    type: 'doctor_exam',
    status: 'approved',
    mix: { easy: 4, medium: 4, hard: 4 },
    pointsPerQuestion: 2,
    durationMinutes: 60,
    window: { kind: 'ended', startDaysAgo: 14, windowMinutes: 120 },
    attemptPlan: { submit: 7, auto_submitted: 5 },
    compensation: true,
  },
  {
    key: 'midterm-cs301',
    title: 'Midterm - Data Structures',
    subjectCode: 'CS301',
    ownerUsername: 'dr.hassan',
    type: 'doctor_exam',
    status: 'approved',
    mix: { easy: 3, medium: 3, hard: 3 },
    pointsPerQuestion: 2,
    durationMinutes: 60,
    window: { kind: 'future', startDaysAhead: 3, windowMinutes: 120 },
    attemptPlan: { not_started: 12 },
  },
  {
    key: 'patterns-cs415',
    title: 'Design Patterns Midterm',
    subjectCode: 'CS415',
    ownerUsername: 'dr.sara',
    type: 'doctor_exam',
    status: 'pending_approval',
    mix: { easy: 3, medium: 3, hard: 3 },
    pointsPerQuestion: 1.5,
    durationMinutes: 45,
    window: { kind: 'future', startDaysAhead: 5, windowMinutes: 120 },
  },
  {
    key: 'probability-quiz-2',
    title: 'Probability Quiz 2',
    subjectCode: 'MATH201',
    ownerUsername: 'dr.omar',
    type: 'doctor_exam',
    status: 'rejected',
    rejectionReason: 'Add at least two hard questions and reschedule to the 10:00 lab hour.',
    mix: { easy: 3, medium: 3, hard: 3 },
    pointsPerQuestion: 3,
    durationMinutes: 45,
    window: { kind: 'future', startDaysAhead: 7, windowMinutes: 90 },
  },
  {
    key: 'practice-cs301',
    title: 'Practice Quiz - Trees and Heaps',
    subjectCode: 'CS301',
    ownerUsername: 'dr.hassan',
    type: 'doctor_exam',
    status: 'approved',
    mix: { easy: 3, medium: 3, hard: 3 },
    pointsPerQuestion: 2,
    durationMinutes: 60,
    window: { kind: 'open', startMinutesAgo: 45, endDaysAhead: 5 },
    attemptPlan: { in_progress: 3 },
  },
  {
    key: 'weekly-quiz-3',
    title: 'Weekly Quiz 3',
    subjectCode: 'CS301',
    ownerUsername: 'ta.nour',
    type: 'ta_quiz',
    status: 'approved',
    quizSource: 'own_questions',
    targetSections: ['Section A'],
    mix: { easy: 2, medium: 2, hard: 2 },
    pointsPerQuestion: 2,
    durationMinutes: 30,
    window: { kind: 'ended', startDaysAgo: 7, windowMinutes: 60 },
    attemptPlan: { submit: 4, auto_submitted: 2 },
  },
  {
    key: 'lab-quiz-4',
    title: 'Lab Quiz 4 - Software Design',
    subjectCode: 'CS415',
    ownerUsername: 'ta.mariam',
    type: 'ta_quiz',
    status: 'approved',
    quizSource: 'own_questions',
    targetSections: ['Section B'],
    mix: { easy: 2, medium: 2, hard: 2 },
    pointsPerQuestion: 2,
    durationMinutes: 30,
    window: { kind: 'open', startMinutesAgo: 30, endDaysAhead: 2 },
    attemptPlan: { in_progress: 2 },
  },
];

export function examWindow(now: Date, spec: ExamWindowSpec): { start: Date; end: Date } {
  if (spec.kind === 'ended') {
    const start = new Date(now.getTime() - spec.startDaysAgo * 86_400_000);
    return { start, end: new Date(start.getTime() + spec.windowMinutes * 60_000) };
  }
  if (spec.kind === 'future') {
    const start = new Date(now.getTime() + spec.startDaysAhead * 86_400_000);
    return { start, end: new Date(start.getTime() + spec.windowMinutes * 60_000) };
  }
  return {
    start: new Date(now.getTime() - spec.startMinutesAgo * 60_000),
    end: new Date(now.getTime() + spec.endDaysAhead * 86_400_000),
  };
}

export function eligibilityUsernames(
  exam: DemoExam,
  enrollments: DemoEnrollment[],
  sections: DemoSection[],
): string[] {
  if (exam.type === 'ta_quiz') {
    const targets = new Set(
      sections
        .filter(
          (s) =>
            s.subjectCode === exam.subjectCode &&
            s.taUsername === exam.ownerUsername &&
            (exam.targetSections ?? []).includes(s.name),
        )
        .map((s) => s.name),
    );
    const rows = enrollments.filter(
      (r) => r.subjectCode === exam.subjectCode && targets.has(r.sectionName),
    );
    return [...new Set(rows.map((r) => r.studentUsername))].sort();
  }
  const rows = enrollments.filter((r) => r.subjectCode === exam.subjectCode);
  return [...new Set(rows.map((r) => r.studentUsername))].sort();
}

export function attemptPlanFor(exam: DemoExam, students: string[]): Record<string, AttemptPlanEntry> {
  const plan: Record<string, AttemptPlanEntry> = {};
  const sorted = [...students].sort();
  const counts = exam.attemptPlan ?? {};
  let cursor = 0;
  for (const entry of ['submit', 'auto_submitted', 'in_progress'] as const) {
    const next = cursor + (counts[entry] ?? 0);
    for (const student of sorted.slice(cursor, next)) {
      plan[student] = entry;
    }
    cursor = Math.min(next, sorted.length);
  }
  for (const student of sorted.slice(cursor)) {
    plan[student] = 'not_started';
  }
  return plan;
}

export function attemptTimestamps(
  now: Date,
  window: { start: Date; end: Date },
  durationMinutes: number,
  entry: AttemptPlanEntry,
  studentIdx: number,
): { startedAt: Date | null; deadline: Date | null; submittedAt: Date | null; heartbeatAt: Date | null } {
  if (entry === 'not_started') {
    return { startedAt: null, deadline: null, submittedAt: null, heartbeatAt: null };
  }
  if (entry === 'in_progress') {
    const startedAt = new Date(now.getTime() - (20 - studentIdx * 2) * 60_000);
    const deadline = new Date(
      Math.min(startedAt.getTime() + durationMinutes * 60_000, window.end.getTime()),
    );
    return { startedAt, deadline, submittedAt: null, heartbeatAt: new Date(now.getTime()) };
  }
  const startedAt = new Date(window.start.getTime() + (2 + studentIdx * 3) * 60_000);
  const deadline = new Date(
    Math.min(startedAt.getTime() + durationMinutes * 60_000, window.end.getTime()),
  );
  if (entry === 'auto_submitted') {
    return { startedAt, deadline, submittedAt: new Date(deadline.getTime()), heartbeatAt: null };
  }
  const submittedAt = new Date(
    Math.min(startedAt.getTime() + (10 + studentIdx * 4) * 60_000, deadline.getTime()),
  );
  return { startedAt, deadline, submittedAt, heartbeatAt: null };
}

export function answeredCountFor(
  entry: AttemptPlanEntry,
  studentIdx: number,
  questionCount: number,
): number {
  if (entry === 'submit') return questionCount;
  if (entry === 'not_started') return 0;
  if (entry === 'auto_submitted') return Math.min(questionCount, (studentIdx + 1) % 3);
  return Math.min(questionCount, (studentIdx % 2) + 1);
}

export function isAnswerCorrect(studentIdx: number, orderIdx: number): boolean {
  return (studentIdx * 3 + orderIdx) % 5 !== 0;
}

export function answerFor(
  snapshot: { question_type: 'mcq' | 'true_false'; options: string[]; correct_answer: string },
  studentIdx: number,
  orderIdx: number,
): string {
  if (isAnswerCorrect(studentIdx, orderIdx)) return snapshot.correct_answer;
  if (snapshot.question_type === 'true_false') {
    return snapshot.correct_answer === 'true' ? 'false' : 'true';
  }
  const current = snapshot.options.indexOf(snapshot.correct_answer);
  const offset = 1 + ((studentIdx + orderIdx) % (snapshot.options.length - 1));
  const option = snapshot.options[(current + offset) % snapshot.options.length];
  if (option == null) {
    throw new Error(
      `Cannot derive an incorrect answer from options: ${snapshot.options.join(' | ')}`,
    );
  }
  return option;
}

export function shouldFlag(entry: AttemptPlanEntry, studentIdx: number, orderIdx: number): boolean {
  return entry === 'in_progress' && (studentIdx + orderIdx) % 4 === 0;
}

export type CompensationRow = {
  studentExamId: string;
  questionId: string;
  selectedAnswer: string | null;
  correctAnswer: string;
};

export function pickCompensationTargets(rows: CompensationRow[]): {
  fullCredit: { questionId: string; studentExamIds: string[] } | undefined;
  setPoints: { questionId: string; studentExamIds: string[] } | undefined;
} {
  const groups = new Map<string, string[]>();
  for (const row of rows) {
    const wrong = row.selectedAnswer == null || row.selectedAnswer !== row.correctAnswer;
    if (!wrong) continue;
    const existing = groups.get(row.questionId) ?? [];
    if (!existing.includes(row.studentExamId)) existing.push(row.studentExamId);
    groups.set(row.questionId, existing);
  }
  const ranked = [...groups.entries()]
    .map(([questionId, studentExamIds]) => ({ questionId, studentExamIds }))
    .sort((a, b) => b.studentExamIds.length - a.studentExamIds.length);
  const first = ranked[0];
  const second = ranked[1];
  return {
    fullCredit: first
      ? { questionId: first.questionId, studentExamIds: first.studentExamIds.slice(0, 2) }
      : undefined,
    setPoints: second
      ? { questionId: second.questionId, studentExamIds: second.studentExamIds.slice(0, 1) }
      : undefined,
  };
}
