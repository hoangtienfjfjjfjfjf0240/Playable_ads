import { redirect } from 'next/navigation';

type ClonePlayablePageProps = {
  params: Promise<{ appId: string }>;
};

export default async function ClonePlayablePage({ params }: ClonePlayablePageProps) {
  const { appId } = await params;
  redirect(`/v2/apps/${appId}/clone`);
}
