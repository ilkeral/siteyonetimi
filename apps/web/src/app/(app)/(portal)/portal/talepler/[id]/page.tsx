'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { TICKET_TYPE_LABELS } from '@sy/shared';
import { api } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { Card, ErrorBox, Loading, SuccessBox } from '@/components/ui';
import { TicketStatusBadge, type TicketStatus } from '@/components/portal';

interface TicketDetail {
  id: string;
  number: number;
  subject: string;
  description: string;
  status: TicketStatus;
  requestType: keyof typeof TICKET_TYPE_LABELS;
  area: string | null;
  date: string;
  completedAt: string | null;
  unit: string | null;
  comments: { id: string; body: string; author: string; mine: boolean; createdAt: string }[];
  survey: { rating: number; comment: string | null; answeredAt: string } | null;
}

export default function PortalTicketPage() {
  const params = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [body, setBody] = useState('');
  const [rating, setRating] = useState(0);
  const [surveyComment, setSurveyComment] = useState('');

  const key = ['portal', 'ticket', params.id];
  const { data, isLoading, error } = useQuery({
    queryKey: key,
    queryFn: () => api.get<TicketDetail>(`/portal/tickets/${params.id}`),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['portal'] });

  const comment = useMutation({
    mutationFn: () => api.post(`/portal/tickets/${params.id}/comments`, { body }),
    onSuccess: () => {
      setBody('');
      void refresh();
    },
  });
  const survey = useMutation({
    mutationFn: () => api.put(`/portal/tickets/${params.id}/survey`, { rating, comment: surveyComment || undefined }),
    onSuccess: () => void refresh(),
  });

  if (isLoading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;

  const steps = [
    { label: 'Alındı', done: true },
    { label: 'İşlemde', done: data.status !== 'WAITING' },
    { label: 'Tamamlandı', done: data.status === 'COMPLETED' },
  ];

  return (
    <>
      <Link href="/portal/talepler" className="small d-inline-block mb-2">
        ← Taleplerim
      </Link>
      <div className="d-flex flex-wrap align-items-center justify-content-between mb-3" style={{ gap: '.5rem' }}>
        <h1 className="h3 m-0">
          <span className="text-muted">#{data.number}</span> {data.subject}
        </h1>
        <TicketStatusBadge status={data.status} />
      </div>

      <ol className="sy-progress-steps mb-4">
        {steps.map((step) => (
          <li key={step.label} className={step.done ? 'is-done' : ''}>
            {step.label}
          </li>
        ))}
      </ol>

      <div className="row">
        <div className="col-lg-8 mb-4">
          <Card title="Yazışma">
            <div className="card-body">
              <div className="sy-chat mine">
                <div className="sy-chat__meta">Siz · {dateTime(data.date)}</div>
                <div style={{ whiteSpace: 'pre-wrap' }}>{data.description}</div>
              </div>
              {data.comments.map((item) => (
                <div key={item.id} className={`sy-chat${item.mine ? ' mine' : ''}`}>
                  <div className="sy-chat__meta">
                    {item.author} · {dateTime(item.createdAt)}
                  </div>
                  <div style={{ whiteSpace: 'pre-wrap' }}>{item.body}</div>
                </div>
              ))}

              <textarea
                className="form-control mt-3 mb-2"
                rows={3}
                placeholder="Mesajınızı yazın..."
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
              {comment.error && <ErrorBox error={comment.error} />}
              <div className="d-flex justify-content-end">
                <button type="button" className="btn btn-primary btn-sm" disabled={!body.trim() || comment.isPending} onClick={() => comment.mutate()}>
                  Gönder
                </button>
              </div>
            </div>
          </Card>
        </div>

        <div className="col-lg-4">
          <Card title="Ayrıntılar" className="mb-4">
            <div className="card-body">
              <dl className="sy-dl mb-0">
                <dt>Tür</dt>
                <dd>{TICKET_TYPE_LABELS[data.requestType]}</dd>
                <dt>Daire</dt>
                <dd>{data.unit ?? 'Ortak alan'}</dd>
                {data.area && (
                  <>
                    <dt>Alan</dt>
                    <dd>{data.area}</dd>
                  </>
                )}
                <dt>Açılış</dt>
                <dd>{dateTime(data.date)}</dd>
                {data.completedAt && (
                  <>
                    <dt>Tamamlanma</dt>
                    <dd>{dateTime(data.completedAt)}</dd>
                  </>
                )}
              </dl>
            </div>
          </Card>

          {data.status === 'COMPLETED' && (
            <Card title="Hizmeti Değerlendirin">
              <div className="card-body">
                {data.survey && !survey.isSuccess ? (
                  <p className="mb-0">
                    Puanınız: <strong>{'★'.repeat(data.survey.rating)}{'☆'.repeat(5 - data.survey.rating)}</strong>
                    {data.survey.comment && <span className="d-block text-muted small mt-1">{data.survey.comment}</span>}
                  </p>
                ) : survey.isSuccess ? (
                  <SuccessBox>Değerlendirmeniz için teşekkürler.</SuccessBox>
                ) : (
                  <>
                    <div className="sy-stars mb-2" role="radiogroup" aria-label="Memnuniyet puanı">
                      {[1, 2, 3, 4, 5].map((value) => (
                        <button
                          key={value}
                          type="button"
                          role="radio"
                          aria-checked={rating === value}
                          aria-label={`${value} puan`}
                          className={value <= rating ? 'is-on' : ''}
                          onClick={() => setRating(value)}
                        >
                          <i className="material-icons">{value <= rating ? 'star' : 'star_border'}</i>
                        </button>
                      ))}
                    </div>
                    <textarea
                      className="form-control mb-2"
                      rows={2}
                      placeholder="Eklemek istedikleriniz (isteğe bağlı)"
                      value={surveyComment}
                      onChange={(e) => setSurveyComment(e.target.value)}
                    />
                    {survey.error && <ErrorBox error={survey.error} />}
                    <button type="button" className="btn btn-primary btn-sm btn-block" disabled={rating < 1 || survey.isPending} onClick={() => survey.mutate()}>
                      Gönder
                    </button>
                  </>
                )}
              </div>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
