import { Card } from '../components/ui/Card';

export function RolePlaceholderPage({ title }: { title: string }) {
  return (
    <Card className="placeholder-page">
      <h1>{title}</h1>
      <p>Coming in a later session.</p>
    </Card>
  );
}
