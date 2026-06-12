import { redirect } from 'next/navigation';

type AppStudioPageProps = {
  params: Promise<{ appId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AppStudioPage({ params, searchParams }: AppStudioPageProps) {
  const { appId } = await params;
  const resolvedSearchParams = await searchParams;
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(resolvedSearchParams)) {
    if (Array.isArray(value)) {
      value.forEach((item) => query.append(key, item));
      continue;
    }

    if (typeof value === 'string') {
      query.set(key, value);
    }
  }

  const queryString = query.toString();
  redirect(`/v2/apps/${appId}${queryString ? `?${queryString}` : ''}`);
}
