import { useQuery } from "@tanstack/react-query";
import { fetchLastUpdated } from "@utils";
import Link from "next/link";
import { useRouter } from "next/router";
import { formatShortDescriptiveDate } from "@utils/format";

export const Footer: React.FC = () => {
  const router = useRouter();
  const isScheduler = router.pathname === "/scheduler";
  const {
    data: lastUpdatedData,
    error,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["lastUpdated"],
    queryFn: fetchLastUpdated,
  });

  return (
    <div className="footer">
      <div className="container footer-container">
        {isScheduler ? (
          <p className="align-items footer__scheduler-credit">
            with (ɔ◔‿◔)ɔ ♥ by{" "}
            <Link
              className="no-underline"
              href="https://brianrahadi.com"
              target="_blank"
              rel="noreferrer"
            >
              brianrahadi
            </Link>
            {" & "}
            <Link
              className="no-underline"
              href="https://andyspersonalwebsite.vercel.app/"
              target="_blank"
              rel="noreferrer"
            >
              andybae
            </Link>
          </p>
        ) : (
          <p className="align-items">
            with (ɔ◔‿◔)ɔ ♥ by{" "}
            <Link
              className="no-underline"
              href="https://brianrahadi.com"
              target="_blank"
              rel="noreferrer"
            >
              brianrahadi
            </Link>
          </p>
        )}
        <p>
          data from&nbsp;
          <Link href="https://api.sfucourses.com" className="no-underline">
            api.sfucourses.com
          </Link>
        </p>
      </div>
    </div>
  );
};
