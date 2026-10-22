import { STAGES } from '../../api/types.js';
import { stageLabel } from '../../lib/board.js';

export default function BoardSkeleton() {
  return (
    <div className="kanban-scroll min-h-0 flex-1 items-start">
      {STAGES.map((stage) => (
        <div key={stage} className="column">
          <div className="column-header">
            <span className="skeleton h-2 w-2 rounded-full" />
            <span className="skeleton h-3 w-20" />
            <span className="skeleton h-4 w-6 rounded-full" />
          </div>
          <div className="column-body">
            {[0, 1, 2].map((index) => (
              <div key={`${stage}-${index}`} className="issue-card">
                <div className="flex items-center gap-2">
                  <span className="skeleton h-2.5 w-12" />
                  <span className="skeleton h-4 w-14 rounded-full" />
                  <span className="skeleton ml-auto h-2.5 w-12" />
                </div>
                <span className="skeleton mt-2 block h-3 w-4/5" />
                <span className="skeleton mt-1.5 block h-3 w-3/5" />
                <div className="mt-3 flex items-center gap-2">
                  <span className="skeleton h-4 w-4 rounded-full" />
                  <span className="skeleton h-2.5 w-20" />
                  <span className="skeleton ml-auto h-2.5 w-10" />
                </div>
              </div>
            ))}
          </div>
          <span className="sr-only">{stageLabel(stage)} loading</span>
        </div>
      ))}
    </div>
  );
}
