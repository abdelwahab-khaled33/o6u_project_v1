import { useState } from 'react';
import { DIFFICULTIES, QUESTION_TYPES, type Difficulty, type QuestionType } from '@exam/shared';

import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Field, Input, Select, Textarea } from '../../components/ui/Field';
import { api } from '../../lib/api';
import { describeError, type Subject } from '../admin/adminShared';

const MIN_OPTIONS = 2;
const MAX_OPTIONS = 8;

export type BankQuestion = {
  id: string;
  question_type: QuestionType;
  text: string;
  options: string[];
  correct_answer: string;
  grade: number | string;
  difficulty: Difficulty;
  image_url: string | null;
  owner_type: string;
  created_at: string;
};

export const TYPE_LABELS: Record<QuestionType, string> = {
  mcq: 'Multiple choice',
  true_false: 'True / False',
};

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

export function gradeValue(grade: number | string): number {
  const parsed = Number(grade);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function formatGrade(grade: number | string): string {
  const parsed = gradeValue(grade);
  if (!Number.isFinite(parsed)) return '—';
  return new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 }).format(parsed);
}

export async function uploadQuestionImage(file: File): Promise<string> {
  const body = new FormData();
  body.append('image', file);
  const result = await api.upload<{ imageUrl: string }>('/question-bank/images', body);
  return result.imageUrl;
}

function typeOptions() {
  return QUESTION_TYPES.map((type) => <option key={type} value={type}>{TYPE_LABELS[type]}</option>);
}

function difficultyOptions() {
  return DIFFICULTIES.map((difficulty) => (
    <option key={difficulty} value={difficulty}>{difficulty}</option>
  ));
}

type QuestionFormProps = {
  subject: Subject;
  question: BankQuestion | null;
  onSaved: (message: string) => void;
  onCancel: () => void;
};

export function QuestionForm({ subject, question, onSaved, onCancel }: QuestionFormProps) {
  const editing = question !== null;
  const existingOptions = question?.options ?? [];
  const [questionType, setQuestionType] = useState<QuestionType>(question?.question_type ?? 'mcq');
  const [text, setText] = useState(question?.text ?? '');
  const [options, setOptions] = useState<string[]>(() => {
    const existing = question?.options ?? [];
    const seeded = existing.length > 0 ? [...existing] : [];
    while (seeded.length < MIN_OPTIONS) seeded.push('');
    return seeded;
  });
  const [correctIndex, setCorrectIndex] = useState(
    question && question.question_type === 'mcq' ? existingOptions.indexOf(question.correct_answer) : 0,
  );
  const [truth, setTruth] = useState<'true' | 'false'>(
    question?.question_type === 'true_false' && question.correct_answer.toLowerCase() === 'false' ? 'false' : 'true',
  );
  const [grade, setGrade] = useState(String(gradeValue(question?.grade ?? 1)));
  const [difficulty, setDifficulty] = useState<Difficulty>(question?.difficulty ?? 'easy');
  const [imageUrl, setImageUrl] = useState(question?.image_url ?? '');
  const [imageName, setImageName] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedOptions = options.map((option) => option.trim());
  const filledOptions = trimmedOptions.filter((option) => option !== '');
  const parsedGrade = Number(grade);
  const gradeValid = Number.isFinite(parsedGrade) && parsedGrade > 0;

  const problems: string[] = [];
  if (text.trim() === '') problems.push('Question text is required.');
  if (!gradeValid) problems.push('Grade must be a number greater than 0.');
  if (questionType === 'mcq') {
    if (filledOptions.length < MIN_OPTIONS) {
      problems.push(`Multiple choice needs at least ${MIN_OPTIONS} options.`);
    }
    if (trimmedOptions.some((option) => option === '')) {
      problems.push('Every option needs text, or remove the empty one.');
    }
    const selected = correctIndex >= 0 ? trimmedOptions[correctIndex] : undefined;
    if (selected === undefined || selected === '') {
      problems.push('Select which option is the correct answer.');
    }
  }
  const valid = problems.length === 0;

  function setOption(index: number, value: string) {
    setOptions((current) => current.map((option, position) => (position === index ? value : option)));
  }

  function addOption() {
    if (options.length >= MAX_OPTIONS) return;
    setOptions((current) => [...current, '']);
  }

  function removeOption(index: number) {
    if (options.length <= MIN_OPTIONS) return;
    setOptions((current) => current.filter((_, position) => position !== index));
    setCorrectIndex((current) => (current > index ? current - 1 : current === index ? -1 : current));
  }

  async function handleImageChange(next: File | null) {
    setImageName('');
    if (!next) return;
    if (!IMAGE_TYPES.includes(next.type)) {
      setError('Only PNG, JPEG, WEBP and GIF images are allowed.');
      return;
    }
    if (next.size > MAX_IMAGE_BYTES) {
      setError('The image must be 5 MB or smaller.');
      return;
    }
    setUploading(true);
    setError(null);
    setImageName(next.name);
    try {
      setImageUrl(await uploadQuestionImage(next));
    } catch (caught) {
      setError(describeError(caught));
      setImageName('');
    } finally {
      setUploading(false);
    }
  }

  async function submit() {
    if (!valid || saving) return;
    setSaving(true);
    setError(null);
    const payload: Record<string, unknown> = {
      question_type: questionType,
      text: text.trim(),
      grade: parsedGrade,
      difficulty,
      image_url: imageUrl === '' ? null : imageUrl,
    };
    if (questionType === 'mcq') {
      const keptOptions = trimmedOptions.filter((option) => option !== '');
      const selected = correctIndex >= 0 ? trimmedOptions[correctIndex] : undefined;
      if (selected === undefined || !keptOptions.includes(selected)) {
        setSaving(false);
        setError('Select which option is the correct answer. It must be one of the options you listed.');
        return;
      }
      payload.options = keptOptions;
      payload.correct_answer = selected;
    } else {
      payload.correct_answer = truth;
    }

    try {
      if (editing) {
        await api.patch(`/question-bank/${question.id}`, payload);
        onSaved('Question updated.');
      } else {
        await api.post('/question-bank', { ...payload, subject_id: subject.id });
        onSaved('Question created.');
      }
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className="form-stack"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <h3>{editing ? 'Edit question' : 'Add question'}</h3>
      <p className="page-intro">
        Subject: {subject.code} — {subject.name}
        {editing && ' (a question cannot move to another subject)'}
      </p>
      {error && <Alert>{error}</Alert>}

      <Field label="Type" htmlFor="question-type">
        <Select
          id="question-type"
          value={questionType}
          onChange={(event) => setQuestionType(event.target.value as QuestionType)}
        >
          {typeOptions()}
        </Select>
      </Field>

      <Field label="Question text" htmlFor="question-text">
        <Textarea id="question-text" value={text} onChange={(event) => setText(event.target.value)} required />
      </Field>

      {questionType === 'mcq' ? (
        <fieldset className="fieldset-reset">
          <legend className="muted">Options — tick the correct answer ({MIN_OPTIONS} to {MAX_OPTIONS})</legend>
          {options.map((option, index) => (
            <div className="option-row" key={index}>
              <input
                id={`question-option-correct-${index}`}
                type="radio"
                name="correct_option"
                checked={correctIndex === index}
                disabled={option.trim() === ''}
                onChange={() => setCorrectIndex(index)}
              />
              <Input
                aria-label={`Option ${index + 1}`}
                value={option}
                onChange={(event) => setOption(index, event.target.value)}
                placeholder={`Option ${index + 1}`}
              />
              <Button
                type="button"
                variant="text"
                disabled={options.length <= MIN_OPTIONS}
                onClick={() => removeOption(index)}
              >
                Remove
              </Button>
            </div>
          ))}
          <div>
            <Button type="button" variant="secondary" disabled={options.length >= MAX_OPTIONS} onClick={addOption}>
              Add option
            </Button>
          </div>
        </fieldset>
      ) : (
        <fieldset className="fieldset-reset">
          <legend className="muted">Correct answer</legend>
          {(['true', 'false'] as const).map((value) => (
            <label className="checkbox-row" key={value} htmlFor={`question-truth-${value}`}>
              <input
                id={`question-truth-${value}`}
                type="radio"
                name="correct_answer"
                checked={truth === value}
                onChange={() => setTruth(value)}
              />
              {value === 'true' ? 'True' : 'False'}
            </label>
          ))}
          <p className="muted">True / False questions carry no option list; the exam snapshot supplies True and False.</p>
        </fieldset>
      )}

      <Field label="Grade" htmlFor="question-grade">
        <Input
          id="question-grade"
          type="number"
          min="0.01"
          step="0.01"
          value={grade}
          onChange={(event) => setGrade(event.target.value)}
          required
        />
      </Field>
      <p className="muted">
        Must be greater than 0. The grade is kept with the question for your own records; an exam scores with its own
        single points-per-question setting, so this value does not decide what a student is awarded.
      </p>

      <Field label="Difficulty" htmlFor="question-difficulty">
        <Select
          id="question-difficulty"
          value={difficulty}
          onChange={(event) => setDifficulty(event.target.value as Difficulty)}
        >
          {difficultyOptions()}
        </Select>
      </Field>

      <Field label="Image (optional)" htmlFor="question-image">
        <Input
          id="question-image"
          type="file"
          accept=".png,.jpg,.jpeg,.webp,.gif"
          disabled={uploading}
          onChange={(event) => { void handleImageChange(event.target.files?.[0] ?? null); }}
        />
      </Field>
      {uploading && <p className="muted">Uploading image…</p>}
      {!uploading && imageName !== '' && <p className="muted">Attached {imageName}.</p>}
      {imageUrl !== '' && (
        <div className="row-actions">
          <img className="image-preview" src={imageUrl} alt="Attached question" />
          <Button type="button" variant="text" onClick={() => { setImageName(''); setImageUrl(''); }}>
            Remove image
          </Button>
        </div>
      )}

      {!valid && (
        <ul className="requirement-list">
          {problems.map((problem) => <li key={problem}>{problem}</li>)}
        </ul>
      )}

      <div className="row-actions">
        <Button type="submit" disabled={!valid || saving || uploading}>
          {saving ? 'Saving…' : editing ? 'Save question' : 'Add question'}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}
